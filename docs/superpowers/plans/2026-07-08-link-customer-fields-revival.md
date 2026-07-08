# Link Customer Fields Revival Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Revive the "Link Customer Fields" sub-panel of the Customers
page's Link Data panel by capturing Link's full, uncurated per-customer
account data (via `GetTaskDetail`'s `parent_task` object, anchored on any
known ticket for that customer) as JSONB, and rendering it as a dynamic
key/value list.

**Architecture:** One new JSONB-backed Postgres table
(`link_customer_fields`); `scripts/write-link-data.js` extended to write to
it via its already-designed-but-unused optional `fields` input key;
`GET /api/link-data/:customerName` extended to stop hardcoding
`fields: null`; a new "Link Customer Fields" sub-panel added back to
`src/js/modules/linkData.js` and `src/index.html`; the manual sync runbook
extended with the fields-lookup step. Purely additive — the existing
tickets sync (`link_customer_tasks`, `link_sync_status`) is unchanged.

**Tech Stack:** Node.js (`pg`), vanilla ES modules, Postgres JSONB. No test
framework exists in this repo — every task is verified with
`psql`/`curl`/`agent-browser`, matching this project's established
convention (see the two prior Link Data plans in this same directory).

## Global Constraints

- No curated/fixed field list — capture and store `parent_task` verbatim,
  as JSONB. Do not design a per-field schema (explicit decision in the
  approved spec).
- Row labels in the UI are raw Link field names, unmodified (no
  prettification/relabeling).
- Row values are cleaned for display: `{Value, RecordID, ...}` objects show
  just `.Value`; arrays are joined; HTML tags are stripped from strings;
  `null`/`undefined`/`''` shows as `—`.
- `scripts/write-link-data.js` changes must be purely additive — existing
  tasks-only sync calls (no `fields` key) must continue to work unchanged.
- No change to the "Copy Sync Command" button's behavior or copied text.
- Follow existing code conventions: DOM built via `document.createElement` +
  `.textContent` for dynamic text, not raw template-string `innerHTML`
  interpolation (see `src/js/modules/customerSelect.js`'s `buildTableRow`).
- Reference spec:
  `docs/superpowers/specs/2026-07-08-link-customer-fields-revival-design.md`.

---

### Task 1: Validate the anchor-ticket fallback for zero-recent-ticket customers (spike)

Decision-gate task, no application code. Determines whether Tasks 2-6 build
the full "widen search" fallback or the simpler "skip fields this round"
fallback for customers with no tickets in the last 14 days.

**Files:** none (investigation only).

**Interfaces:**
- Consumes: `orangelogic-foundation` MCP tools `SearchTask` and
  `GetTaskDetail`.
- Produces: a PASS/FAIL decision recorded in this plan file (edit this file
  to add a `**Spike result:**` line under this task) and, if PASS, the
  exact working query pattern to use for the fallback, to be used verbatim
  in Task 6's runbook update.

- [x] **Step 1: Pick two customers confirmed to have zero tickets in the last 14 days**

  Use "PMC" and "A&E Networks" — both confirmed zero-task in this session's
  `GetCustomerRecentWork` calls for the window 2026-06-24 to 2026-07-08.

  Their known-good local values (for cross-checking in Step 3), from
  `psql -d qa_dashboard -c "SELECT prod_url, test_url FROM customers WHERE customer_name IN ('PMC', 'A&E Networks');"`:
  - PMC: prod `https://dam.pmc.orangelogic.com`, test `https://dam-test.pmc.orangelogic.com`
  - A&E Networks: prod `https://thestan.aenetworks.com/olsso`, test `https://dam-test.aae.orangelogic.com/`

- [x] **Step 2: Find a candidate anchor ticket for each**

  Call `SearchTask` with `query: "PMC"`, `is_semantic: true`,
  `fields: ["CoreField.Title", "SystemIdentifier", "ParentFolderIdentifier", "CoreField.DocSubType"]`,
  `page_size: 5`. Repeat with `query: "A&E Networks"`.

  Pick the top result for each as the candidate anchor ticket.

- [x] **Step 3: Verify each candidate genuinely belongs to the intended customer**

  Call `GetTaskDetail(ticket_id)` on each candidate. In the response's
  `parent_task` object, look for `InheritedValue.Production-Site-URL` and
  `InheritedValue.Test-Site-URL` (strip any HTML markup — they come back as
  `<a href="...">...</a>`). Compare against the known-good local values from
  Step 1.

  **PASS** if both URLs match (or at least one matches and the other is
  plausibly blank/different-but-related, e.g. a redirect) for both
  customers. **FAIL** if the URLs are for a clearly different customer, or
  if `parent_task` is missing/empty for either candidate.

- [x] **Step 4: Record the outcome**

  **Spike result:** PASS — working query: `SearchTask(query: "<customerName>", is_semantic: true, page_size: 5)`, take the top result's `SystemIdentifier` as the anchor ticket. Verified against both test customers: PMC's top result ("Access to PMC secondary and test databases") resolved via `GetTaskDetail` to a `parent_task` with `InheritedValue.Production-Site-URL` = `https://dam.pmc.orangelogic.com` and `InheritedValue.Test-Site-URL` = `https://dam-test.pmc.orangelogic.com` — exact match to the local DB. A&E Networks' top result (an untitled "Other"-type ticket) resolved to a `parent_task` with `InheritedValue.Production-Site-URL` = `https://thestan.aenetworks.com/olsso` and `InheritedValue.Test-Site-URL` = `https://dam-test.aae.orangelogic.com/` — also an exact match. Both customers confirmed correctly, no cross-customer contamination.

  Edit this plan file and add directly under this task's heading:
  `**Spike result:** PASS — working query: <exact query string/params that worked>`
  or `**Spike result:** FAIL — <one-line reason>`.

  **If PASS:** continue to Tasks 2-6 as written (full "widen search"
  fallback).
  **If FAIL:** skip the "widen search" step in Task 6's runbook update —
  use the simpler "skip fields this round" fallback for customers with zero
  recent tickets (already specified as the fallback-of-the-fallback in the
  approved spec's Error Handling section).

---

### Task 2: Database schema — `link_customer_fields` table

**Files:**
- Modify: `src/db/schema.sql:78` (insert after the existing
  `link_sync_status` table, before the `-- Postman collections cache`
  comment)

**Interfaces:**
- Consumes: existing `customers` table (`customer_name`, already has the
  unique index needed for FK targeting from `src/db/schema.sql:53`).
- Produces: `link_customer_fields` table (PK `customer_name`, `ON DELETE
  CASCADE`), consumed by Tasks 3 and 4 via exact column names `customer_name`,
  `data` (JSONB), `synced_at`.

- [ ] **Step 1: Add the migration SQL**

  Insert into `src/db/schema.sql` immediately after line 78 (the closing
  `);` of `link_sync_status`) and before line 80's
  `-- Postman collections cache` comment:

  ```sql

  -- Raw per-customer Link account/profile data (uncurated) — captured via
  -- GetTaskDetail's parent_task on any known ticket for that customer. See
  -- docs/superpowers/specs/2026-07-08-link-customer-fields-revival-design.md.
  CREATE TABLE IF NOT EXISTS link_customer_fields (
      customer_name TEXT PRIMARY KEY REFERENCES customers(customer_name) ON DELETE CASCADE,
      data          JSONB NOT NULL,
      synced_at     TIMESTAMPTZ NOT NULL
  );
  ```

- [ ] **Step 2: Apply the migration**

  Run: `psql -d qa_dashboard -f src/db/schema.sql`
  Expected: no errors (idempotent, safe to re-run).

- [ ] **Step 3: Verify the table shape**

  Run: `psql -d qa_dashboard -c "\d link_customer_fields"`
  Expected: columns `customer_name` (PK), `data` (jsonb, not null),
  `synced_at`, and a `Foreign-key constraints` line referencing `customers`.

- [ ] **Step 4: Verify JSONB round-trip and cascade delete**

  ```bash
  psql -d qa_dashboard <<'EOF'
  BEGIN;
  INSERT INTO customers (unique_id, customer_name) VALUES ('TEST-JSONB-1', 'JSONB Test Co');
  INSERT INTO link_customer_fields (customer_name, data, synced_at) VALUES ('JSONB Test Co', '{"foo":"bar","nested":{"Value":"baz"}}'::jsonb, NOW());
  SELECT data->>'foo' AS foo_value, data->'nested'->>'Value' AS nested_value FROM link_customer_fields WHERE customer_name = 'JSONB Test Co';
  DELETE FROM customers WHERE customer_name = 'JSONB Test Co';
  SELECT COUNT(*) FROM link_customer_fields WHERE customer_name = 'JSONB Test Co';
  ROLLBACK;
  EOF
  ```

  Expected: the `SELECT` shows `foo_value = bar`, `nested_value = baz`
  (confirms JSONB read/write and path navigation work); the final
  `SELECT COUNT(*)` returns `0` (cascade delete worked) before `ROLLBACK`
  undoes the whole test.

- [ ] **Step 5: Commit**

  ```bash
  git add src/db/schema.sql
  git commit -m "Add link_customer_fields table (JSONB, uncurated)"
  ```

---

### Task 3: Extend `scripts/write-link-data.js` to write fields

**Files:**
- Modify: `scripts/write-link-data.js` (full replacement — small enough to
  do in one step)

**Interfaces:**
- Consumes: JSON on stdin, now
  `{ customerName: string, fields?: object, tasks: Array<{taskPath, taskType, status, totalMinutes, teams}> }`.
  `fields`, when present, is the raw `GetTaskDetail` `parent_task` object —
  stored verbatim, no transformation.
- Produces: rows in `link_customer_fields` (new, from Task 2) in addition
  to the existing `link_customer_tasks`/`link_sync_status` writes. Same
  exit code contract as before (`0` success, `1` + stderr on failure).

- [ ] **Step 1: Replace the script**

  Replace `scripts/write-link-data.js` in full:

  ```js
  #!/usr/bin/env node
  /**
   * write-link-data.js — upserts one customer's synced Link data into Postgres.
   *
   * Usage: echo '<json>' | node scripts/write-link-data.js
   * Input JSON shape: {
   *   "customerName": string,
   *   "fields"?: object,  // raw GetTaskDetail parent_task object; omit if unavailable
   *   "tasks": Array<{taskPath, taskType, status, totalMinutes, teams}>
   * }
   *
   * "fields" is stored verbatim as JSONB — no curation. See
   * docs/superpowers/specs/2026-07-08-link-customer-fields-revival-design.md.
   */
  const { Pool } = require('pg');
  const fs = require('fs');
  const path = require('path');

  function loadConfig() {
    try {
      return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'qa-dashboard.config.json'), 'utf8'));
    } catch {
      return {};
    }
  }

  async function main() {
    const raw = fs.readFileSync(0, 'utf8');
    let input;
    try {
      input = JSON.parse(raw);
    } catch (e) {
      console.error(`Invalid JSON on stdin: ${e.message}`);
      process.exit(1);
    }

    const { customerName, fields, tasks } = input;
    if (!customerName || typeof customerName !== 'string') {
      console.error('customerName is required');
      process.exit(1);
    }

    const config = loadConfig();
    if (!config.database) {
      console.error('No database config found in qa-dashboard.config.json');
      process.exit(1);
    }
    const pool = new Pool(config.database);

    try {
      if (fields && typeof fields === 'object') {
        await pool.query(
          `INSERT INTO link_customer_fields (customer_name, data, synced_at) VALUES ($1, $2, NOW())
           ON CONFLICT (customer_name) DO UPDATE SET data = EXCLUDED.data, synced_at = NOW()`,
          [customerName, JSON.stringify(fields)]
        );
      }

      await pool.query('DELETE FROM link_customer_tasks WHERE customer_name = $1', [customerName]);
      for (const t of tasks || []) {
        await pool.query(
          `INSERT INTO link_customer_tasks (customer_name, task_path, task_type, status, total_minutes, teams, synced_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
          [customerName, t.taskPath ?? null, t.taskType ?? null, t.status ?? null, t.totalMinutes ?? null, t.teams ?? null]
        );
      }

      await pool.query(
        `INSERT INTO link_sync_status (customer_name, synced_at) VALUES ($1, NOW())
         ON CONFLICT (customer_name) DO UPDATE SET synced_at = NOW()`,
        [customerName]
      );

      console.log(`Synced ${customerName}: fields=${fields ? 'yes' : 'no'}, tasks=${(tasks || []).length}`);
    } finally {
      await pool.end();
    }
  }

  main().catch(err => {
    console.error(`write-link-data.js failed: ${err.message}`);
    process.exit(1);
  });
  ```

- [ ] **Step 2: Test the fields+tasks path against a real seeded customer ("PMC")**

  ```bash
  echo '{"customerName":"PMC","fields":{"RelatedValue.Customer-Success-Manager":"Test CSM","InheritedValue.Production-Site-URL":["<a href=\"https://example.com\">https://example.com</a>"]},"tasks":[{"taskPath":"PMC > Support > Test","taskType":null,"status":"Closed","totalMinutes":10,"teams":"QA"}]}' | node scripts/write-link-data.js
  ```

  Expected stdout: `Synced PMC: fields=yes, tasks=1`

  Verify: `psql -d qa_dashboard -c "SELECT data->>'RelatedValue.Customer-Success-Manager' AS csm FROM link_customer_fields WHERE customer_name='PMC';"`
  Expected: `csm = Test CSM`.

- [ ] **Step 3: Test the tasks-only path (fields omitted) still works**

  ```bash
  echo '{"customerName":"PMC","tasks":[]}' | node scripts/write-link-data.js
  ```

  Expected stdout: `Synced PMC: fields=no, tasks=0`
  Verify: `psql -d qa_dashboard -c "SELECT data->>'RelatedValue.Customer-Success-Manager' AS csm FROM link_customer_fields WHERE customer_name='PMC';"`
  Expected: still `csm = Test CSM` (fields omission does not clear a
  previously-synced fields row — same documented behavior as the original
  tasks/fields interaction, now applying to the real `fields` column
  instead of the dropped one).

- [ ] **Step 4: Clean up test data**

  ```bash
  psql -d qa_dashboard -c "DELETE FROM link_customer_fields WHERE customer_name='PMC'; DELETE FROM link_customer_tasks WHERE customer_name='PMC'; DELETE FROM link_sync_status WHERE customer_name='PMC';"
  ```

- [ ] **Step 5: Commit**

  ```bash
  git add scripts/write-link-data.js
  git commit -m "Extend write-link-data.js to write raw Link customer fields as JSONB"
  ```

---

### Task 4: Return real fields from `GET /api/link-data/:customerName`

**Files:**
- Modify: `scripts/dev-server.js:421-438` (the existing `/api/link-data/:customerName`
  route)

**Interfaces:**
- Consumes: `link_customer_fields` (Task 2/3) via the existing `pgPool`.
- Produces: `GET /api/link-data/:customerName` now returns
  `fields: <raw JSONB object> | null` instead of a hardcoded `null`, along
  with the existing `tasks`/`syncedAt`.

- [ ] **Step 1: Replace the route**

  In `scripts/dev-server.js`, replace the existing route body (lines
  421-438 — from the `// GET /api/link-data/:customerName` comment through
  its closing `}`) with:

  ```js
    // GET /api/link-data/:customerName — Link data cache, read-only
    const linkMatch = url.match(/^\/api\/link-data\/(.+)$/);
    if (linkMatch && req.method === 'GET') {
      const customerName = decodeURIComponent(linkMatch[1]);
      const { rows: taskRows } = await pgPool.query(
        `SELECT task_path AS "taskPath", task_type AS "taskType", status,
                total_minutes AS "totalMinutes", teams
         FROM link_customer_tasks WHERE customer_name = $1 ORDER BY total_minutes DESC NULLS LAST`,
        [customerName]
      );
      const { rows: fieldRows } = await pgPool.query(
        `SELECT data FROM link_customer_fields WHERE customer_name = $1`,
        [customerName]
      );
      const { rows: syncRows } = await pgPool.query(
        `SELECT synced_at AS "syncedAt" FROM link_sync_status WHERE customer_name = $1`,
        [customerName]
      );
      return jsonResponse(res, 200, {
        fields: fieldRows[0]?.data ?? null,
        tasks: taskRows,
        syncedAt: syncRows[0]?.syncedAt ?? null,
      });
    }
  ```

- [ ] **Step 2: Restart the dev server**

  Run: `npm run dev`

- [ ] **Step 3: Test the never-synced case**

  Run: `curl -s http://localhost:3000/api/link-data/PMC`
  Expected: `{"fields":null,"tasks":[],"syncedAt":null}`

- [ ] **Step 4: Test the synced case**

  ```bash
  echo '{"customerName":"PMC","fields":{"RelatedValue.Customer-Success-Manager":"Test CSM"},"tasks":[]}' | node scripts/write-link-data.js
  curl -s http://localhost:3000/api/link-data/PMC
  ```

  Expected: `fields` is `{"RelatedValue.Customer-Success-Manager":"Test CSM"}`,
  `syncedAt` is a non-null timestamp.

- [ ] **Step 5: Clean up**

  ```bash
  psql -d qa_dashboard -c "DELETE FROM link_customer_fields WHERE customer_name='PMC'; DELETE FROM link_sync_status WHERE customer_name='PMC';"
  ```

- [ ] **Step 6: Commit**

  ```bash
  git add scripts/dev-server.js
  git commit -m "Return real Link customer fields from GET /api/link-data/:customerName"
  ```

---

### Task 5: Frontend — "Link Customer Fields" sub-panel

**Files:**
- Modify: `src/index.html:202-203` (insert new sub-panel between the
  panel-header's closing `</div>` and the existing "Recent Link Tickets"
  sub-panel)
- Modify: `src/css/customer.css` (restore sub-panel spacing rule, add a new
  scroll-container rule)
- Modify: `src/js/modules/linkData.js` (full replacement)

**Interfaces:**
- Consumes: `GET /api/link-data/:customerName`'s `fields` property (Task 4)
  — an arbitrary JSON object or `null`.
- Produces: nothing consumed elsewhere — leaf UI change.

- [ ] **Step 1: Add the HTML sub-panel**

  In `src/index.html`, insert between line 202 (`      </div>` — closing
  the panel-header) and line 204 (`      <div class="ld-subpanel">` —
  the existing "Recent Link Tickets" sub-panel):

  ```html

      <div class="ld-subpanel">
        <div class="ld-subpanel-title">Link Customer Fields</div>
        <div class="ld-fields-wrap">
          <div id="link-fields-grid" class="cs-grid">
            <div class="empty-state"><div class="empty-title">Never synced</div></div>
          </div>
        </div>
      </div>
  ```

- [ ] **Step 2: Add CSS**

  Append to `src/css/customer.css`:

  ```css

  .ld-subpanel + .ld-subpanel {
    margin-top: 1.5rem;
  }

  .ld-fields-wrap {
    max-height: 340px;
    overflow-y: auto;
  }
  ```

  (`.ld-subpanel + .ld-subpanel` was removed when the fields sub-panel was
  dropped in the original build, since only one sub-panel remained — it's
  needed again now that there are two.)

- [ ] **Step 3: Replace `src/js/modules/linkData.js`**

  Full file:

  ```js
  /**
   * linkData.js — renders the "Link Data" panel for the selected customer.
   * Reads only from /api/link-data/:customerName; never talks to Link directly.
   *
   * "Link Customer Fields" shows Link's raw per-customer account data,
   * uncurated — see
   * docs/superpowers/specs/2026-07-08-link-customer-fields-revival-design.md.
   * "Recent Link Tickets" shows the last synced 14-day ticket window.
   */

  import { getSelectedCustomer } from './customerSelect.js';

  const COPY_LABEL = 'Copy Sync Command';
  const COPIED_LABEL = 'Copied!';
  const COPIED_RESET_MS = 1500;

  function stripHtml(str) {
    return String(str).replace(/<[^>]*>/g, '');
  }

  function displayValue(raw) {
    if (raw === null || raw === undefined || raw === '') return '—';
    if (Array.isArray(raw)) {
      const parts = raw.map(displayValue).filter(v => v !== '—');
      return parts.length ? parts.join(', ') : '—';
    }
    if (typeof raw === 'object') {
      return raw.Value !== undefined ? displayValue(raw.Value) : '—';
    }
    const text = stripHtml(String(raw)).trim();
    return text || '—';
  }

  function renderFields(container, fields) {
    container.replaceChildren();
    if (!fields) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.innerHTML = '<div class="empty-title">No data</div>';
      container.appendChild(empty);
      return;
    }
    Object.entries(fields).forEach(([key, value]) => {
      const field = document.createElement('div');
      field.className = 'cs-field';
      const labelEl = document.createElement('span');
      labelEl.className = 'cs-label';
      labelEl.textContent = key;
      const valueEl = document.createElement('span');
      valueEl.className = 'cs-value';
      valueEl.textContent = displayValue(value);
      field.append(labelEl, valueEl);
      container.appendChild(field);
    });
  }

  function renderTasks(tbody, tasks) {
    if (!tasks.length) {
      tbody.innerHTML = '<tr><td colspan="5"><div class="empty-state"><div class="empty-title">No recent tickets</div></div></td></tr>';
      return;
    }
    tbody.replaceChildren(...tasks.map(t => {
      const tr = document.createElement('tr');
      [t.taskPath, t.taskType, t.status, t.totalMinutes, t.teams].forEach(value => {
        const td = document.createElement('td');
        td.textContent = (value === null || value === undefined || value === '') ? '—' : String(value);
        tr.appendChild(td);
      });
      return tr;
    }));
  }

  function formatSyncedAt(iso) {
    return iso ? new Date(iso).toLocaleString() : null;
  }

  function updateSyncButton(customer) {
    const btn = document.getElementById('link-data-sync-btn');
    if (!btn) return;
    btn.disabled = customer.customerName.startsWith('QA-');
    btn.textContent = COPY_LABEL;
  }

  async function loadLinkData(customer) {
    updateSyncButton(customer);

    const syncBadge = document.getElementById('link-data-synced');
    const fieldsGrid = document.getElementById('link-fields-grid');
    const tasksBody = document.getElementById('link-tasks-tbody');
    if (!syncBadge || !fieldsGrid || !tasksBody) return;

    if (customer.customerName.startsWith('QA-')) {
      syncBadge.textContent = 'Not synced (excluded)';
      renderFields(fieldsGrid, null);
      renderTasks(tasksBody, []);
      return;
    }

    try {
      const resp = await fetch(`/api/link-data/${encodeURIComponent(customer.customerName)}`);
      if (!resp.ok) throw new Error(`Link data API error: ${resp.status}`);
      const data = await resp.json();
      syncBadge.textContent = data.syncedAt ? `Last synced: ${formatSyncedAt(data.syncedAt)}` : 'Never synced';
      renderFields(fieldsGrid, data.fields);
      renderTasks(tasksBody, data.tasks || []);
    } catch (err) {
      console.warn('Link data unavailable:', err.message);
      syncBadge.textContent = 'Never synced';
      renderFields(fieldsGrid, null);
      renderTasks(tasksBody, []);
    }
  }

  async function copySyncCommand() {
    const customer = getSelectedCustomer();
    if (!customer) return;
    const btn = document.getElementById('link-data-sync-btn');
    const promptText = `Sync Link data for customer "${customer.customerName}" (single customer only) per docs/link-data-sync-runbook.md.`;

    try {
      await navigator.clipboard.writeText(promptText);
      if (btn) {
        btn.textContent = COPIED_LABEL;
        setTimeout(() => { btn.textContent = COPY_LABEL; }, COPIED_RESET_MS);
      }
    } catch (err) {
      console.warn('Clipboard write failed, falling back to prompt:', err.message);
      window.prompt('Copy this into a Claude Code session:', promptText);
    }
  }

  export function initLinkData() {
    document.addEventListener('customer:selected', e => loadLinkData(e.detail));
    document.getElementById('link-data-sync-btn')?.addEventListener('click', copySyncCommand);
  }
  ```

- [ ] **Step 4: Seed realistic test data for browser verification**

  ```bash
  echo '{"customerName":"PMC","fields":{"RelatedValue.Customer-Success-Manager":"Jeff Senuta","InheritedValue.Production-Site-URL":["<a href=\"https://dam.pmc.orangelogic.com\" target=\"_blank\">https://dam.pmc.orangelogic.com</a>"],"InheritedValue.Inherited-Customer-Status":"Support","Customer.SLA-Check":false,"RelatedValue.Empty-Field":""},"tasks":[{"taskPath":"PMC > Support > Bug fix","taskType":null,"status":"Closed","totalMinutes":120,"teams":"Engineering"}]}' | node scripts/write-link-data.js
  ```

- [ ] **Step 5: Verify in a real browser with `agent-browser`**

  ```bash
  agent-browser open http://localhost:3000/index.html
  agent-browser wait --load networkidle
  agent-browser find text "PMC" click --exact
  agent-browser wait --text "Last synced"
  agent-browser snapshot -i -s "#link-fields-grid"
  ```

  Expected: the snapshot shows rows including
  `RelatedValue.Customer-Success-Manager: Jeff Senuta`,
  `InheritedValue.Production-Site-URL: https://dam.pmc.orangelogic.com`
  (HTML stripped — no `<a href...>` markup visible),
  `Customer.SLA-Check: false`, and `RelatedValue.Empty-Field: —` (empty
  string correctly shown as an em-dash).

  Then re-verify the excluded and never-synced states still work
  (regression check on Task 5's previous behavior):

  ```bash
  agent-browser find text "QA-Queenstown" click --exact
  agent-browser wait --text "Not synced (excluded)"
  agent-browser find text "Pinterest" click --exact
  agent-browser wait --text "Never synced"
  agent-browser console
  agent-browser errors
  agent-browser close
  ```

  Expected: both waits succeed, `console`/`errors` empty.

- [ ] **Step 6: Clean up test data**

  ```bash
  psql -d qa_dashboard -c "DELETE FROM link_customer_fields WHERE customer_name='PMC'; DELETE FROM link_customer_tasks WHERE customer_name='PMC'; DELETE FROM link_sync_status WHERE customer_name='PMC';"
  ```

- [ ] **Step 7: Commit**

  ```bash
  git add src/index.html src/css/customer.css src/js/modules/linkData.js
  git commit -m "Add Link Customer Fields sub-panel to the Link Data panel"
  ```

---

### Task 6: Update the sync runbook and run one real end-to-end dry run

**Files:**
- Modify: `docs/link-data-sync-runbook.md`

**Interfaces:**
- Consumes: `orangelogic-foundation` MCP tools `GetCustomerRecentWork`,
  `SearchTask` (only if Task 1's spike PASSed), `GetTaskDetail`; existing
  `scripts/write-link-data.js` (Task 3).
- Produces: nothing consumed by other tasks — final task.

- [ ] **Step 1: Update the runbook's procedure**

  In `docs/link-data-sync-runbook.md`, remove the "Note" callout that says
  Link Customer-record fields are out of scope, and replace step 3 with:

  ```markdown
  3. For each remaining customer:
     a. Call `GetCustomerRecentWork` with `customer: "<name>"`,
        `time_start`: 14 days before today (ISO 8601), `time_end`: today
        (ISO 8601).
     b. Pick an anchor ticket for the fields lookup: if step 3a returned at
        least one task, use its `taskId`. If it returned zero tasks,
  ```

  **If Task 1's spike result was PASS**, continue the step with:

  ```markdown
        call `SearchTask` with `query: "<name>"`, `is_semantic: true`,
        `page_size: 5`, and use the top result's `SystemIdentifier` as the
        anchor instead.
     c. Call `GetTaskDetail(anchor ticket ID)`. If the response has a
        `parent_task` object, that is the customer's `fields` value
        (verbatim, no transformation). If there is no `parent_task`, omit
        `fields` for this customer this run.
  ```

  **If Task 1's spike result was FAIL**, continue the step with:

  ```markdown
        omit `fields` for this customer this run (no reliable fallback
        anchor exists for customers with no recent ticket activity).
     c. If step 3b found an anchor ticket, call `GetTaskDetail(anchor ticket ID)`.
        If the response has a `parent_task` object, that is the customer's
        `fields` value (verbatim, no transformation). If there is no
        `parent_task`, omit `fields` for this customer this run.
  ```

  Then (both cases) keep the existing sub-steps, renumbered, for building
  and piping the payload:

  ```markdown
     d. `GetCustomerRecentWork` has been observed to return every task twice
        in the `tasks` array with identical `taskId`s (e.g. `totalTasks: 20`
        but `returned: 40`). Before building the payload, de-duplicate
        `tasks` by `taskId`, keeping one copy of each unique `taskId`.
        Build the JSON payload:
        `{"customerName": "<name>", "fields": <parent_task object, or omit>, "tasks": [<mapped, de-duplicated tasks>]}`
        — map the de-duplicated `tasks[].path` → `taskPath`,
        `.subType` → `taskType` (the tool's response field is `subType`, not
        `type`; it may be `null`), `.status` → `status`,
        `.totalMinutes` → `totalMinutes`, `.teams` → `teams`.

        If `teams` comes back as an array rather than a string, join it with
        ", " before including it in the payload. `totalMinutes` should be a
        plain integer; coerce with `Number(...)` if the tool returns it as a
        string.
     e. Pipe it in: `echo '<json>' | node scripts/write-link-data.js`
     f. If that command exits non-zero, record `<name>` as failed and
        continue to the next customer — do not stop the whole run.
  ```

- [ ] **Step 2: Dry-run one real customer end to end, including fields**

  Pick a real, non-`QA-` customer with recent ticket activity (e.g. "ACLU",
  which by now may have activity, or re-check any customer from
  `GetCustomerRecentWork` and pick one with `totalTasks > 0`). Perform the
  full updated procedure live: fetch recent tasks, get an anchor ticket
  (from the tasks themselves if any exist), call `GetTaskDetail`, extract
  `parent_task`, de-duplicate tasks by `taskId`, build the combined payload,
  pipe to `write-link-data.js`.

  Verify: `curl -s http://localhost:3000/api/link-data/<that customer's name>`
  Expected: `fields` is a real, non-null, non-empty object (not the
  hand-crafted test fixture from earlier tasks), `tasks` reflects real
  ticket data, `syncedAt` is current.

- [ ] **Step 3: Commit**

  ```bash
  git add docs/link-data-sync-runbook.md
  git commit -m "Update sync runbook: capture raw Link customer fields via anchor-ticket lookup"
  ```

---

## Self-Review

**Spec coverage:** every section of
`docs/superpowers/specs/2026-07-08-link-customer-fields-revival-design.md`
maps to a task — no-curation JSONB storage (Task 2/3), API passthrough
(Task 4), dynamic UI rendering with value cleanup (Task 5), zero-ticket
fallback validated by spike before being written into the runbook (Task 1
→ Task 6), error-handling edge cases (skip-and-continue, no-`parent_task`
case, cascade delete) all present in Task 6's procedure and Task 2's
schema. Out-of-scope items (no change to Copy Sync Command, no retry logic
for alternate anchors) correctly absent from every task.

**Placeholder scan:** none found — Task 1's exploratory steps have concrete
starting queries and a concrete PASS/FAIL rubric (URL cross-check against
known local DB values), same pattern as the original plan's Task 1.

**Type consistency:** `fields` key name and shape (raw object, JSONB) is
consistent from `write-link-data.js` (Task 3) → `link_customer_fields.data`
column (Task 2) → API response `fields` property (Task 4) →
`renderFields()`'s parameter (Task 5). `displayValue()`'s handling of
`{Value, ...}` objects, arrays, and HTML strings matches the exact value
shapes observed in this session's live `GetTaskDetail` investigation
(e.g. `{"Value":"Non-Standard","RecordID":"..."}`, `["<a href=...>...</a>"]`).
