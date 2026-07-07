# Link Data Section Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Link Data" panel to the Customers page that shows, for the
currently selected customer, a curated set of Link (link.orangelogic.com)
Customer-record fields and their recent Link tickets — both sourced from a
manually-synced Postgres cache, never a live call from the running app.

**Architecture:** Two new Postgres tables (`link_customer_fields`,
`link_customer_tasks`) populated by a new stdin-driven script
(`scripts/write-link-data.js`); a new read-only `dev-server.js` route
(`GET /api/link-data/:customerName`); a new frontend module
(`src/js/modules/linkData.js`) that renders the panel whenever a customer is
selected. The actual Link sync is a manual, human/Claude-triggered procedure
(documented as a runbook) — it is explicitly not part of the app's runtime.

**Tech Stack:** Node.js (`pg` — already a dependency), vanilla ES modules,
Postgres. No test framework exists in this repo (confirmed in `CLAUDE.md`) —
every task below is verified with `psql`/`curl`/`agent-browser` instead of
unit tests, matching the project's existing convention (see how the
"Refresh" button was verified in this same session).

## Global Constraints

- Idempotent schema: all DDL in `src/db/schema.sql` must be safe to re-run
  (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`) — this is the
  file's existing documented contract.
- No live Link/MCP calls from `dev-server.js` or the browser — the app only
  ever reads from Postgres for Link data.
- Customers whose name starts with `QA-` are excluded from the Link sync
  entirely (explicit decision in the approved design spec).
- No automatic drift/mismatch highlighting between Link values and the
  existing local `customers` table values (explicit decision).
- Never commit `src/data/CustomerDataExport.csv` or `.env` — both are
  git-ignored; do not change that.
- Follow existing code conventions: DOM built via `document.createElement` +
  `.textContent` for user-controlled text (see `src/js/modules/customerSelect.js`
  `buildTableRow`), not raw template-string `innerHTML` interpolation.
- Reference spec: `docs/superpowers/specs/2026-07-07-link-data-section-design.md`.

---

### Task 1: Validate the Link Customer-record query pattern (spike)

**Spike result:** FAIL — `Customer.Customer-Name:"<name>"` returns multiple ticket-scoped rows per customer (19 for Pinterest, 8 for PMC), nearly all fields blank except Customer-Success-Manager/Timezone, with no reliable way to pick "the" record; the one customer that did return exactly one row (ACLU) only had 4 of 12 fields populated (33%, below the half-fields bar); `RelatedValue.Customer:"Pinterest"` was worse (1 row, every field including Customer-Name blank); `LookupModuleId` found no "Customer"/"Account"/"Customers" module at all (`Customer` module fields live on ticket/task records, not a dedicated master-record module).

This is a decision-gate task, not a code-writing task. Its outcome
determines whether Tasks 2–6 build the full scope (fields + tickets) or the
tickets-only fallback. No files are created or modified in this task.

**Files:** none (investigation only).

**Interfaces:**
- Consumes: the `orangelogic-foundation` MCP tools `LookupModuleId` and
  `SearchTask` (available in any Claude Code session with that plugin
  enabled), and the tool `JqTempFile` for inspecting `SearchTask` results.
- Produces: a PASS/FAIL decision recorded at the top of this plan file (edit
  this file to add a `**Spike result:**` line under this task once run) and,
  if PASS, the exact working `SearchTask` query string and field list to
  reuse verbatim in Task 6's runbook.

- [x] **Step 1: Look up the Customer/Account module**

  Call `LookupModuleId` with `module_name: "Customer"`, `exact_only: false`.
  Read the `matches` array and identify the module that represents the
  master customer/account record (not a sub-feature or unrelated module
  that merely contains the word "Customer"). Note its `record_id`.

- [x] **Step 2: Query one known real customer**

  Call `SearchTask` with:
  - `query`: start with `Customer.Customer-Name:"Pinterest"`. If that
    returns zero results or clearly wrong records, try
    `RelatedValue.Customer:"Pinterest"`, or scope by module using
    `CoreField.ParentRecordID:("<record_id from Step 1>")` combined with a
    name filter — use judgment, this is exploratory.
  - `fields`: `["Customer.Customer-Name", "RelatedValue.Customer-POC",
    "RelatedValue.Customer-Success-Manager", "customer.Implementation-Partner",
    "customer.SLA-Contract-Type", "Customer.Can-upgrade-over-any-weekend_x003F_",
    "Customer.Purchased-Modules", "customer.Primary-Production-URL",
    "customer.Test-URL", "customer.Authorized-Access---Notes",
    "InheritedValue.Customer-Timezone", "Customer.Launch-Date",
    "customer.Is-live_x003F_"]`
  - `page_size`: `5`

  Use `JqTempFile` on the returned `output_file` to inspect the actual rows.

- [x] **Step 3: Repeat Step 2 for "PMC" and "ACLU"**

  Use the same query pattern (adjusted per whatever worked in Step 2) for
  these two additional real, non-`QA-`-prefixed customers.

- [x] **Step 4: Judge PASS/FAIL**

  **PASS** if each of the 3 customers returns exactly one clean record with
  at least half of the 12 requested fields populated with plausible
  (non-garbage) values — not zero results, not dozens of unrelated ticket
  rows, not all-null fields.

  **FAIL** otherwise.

- [x] **Step 5: Record the outcome**

  Edit this plan file and add directly under this task's heading:
  `**Spike result:** PASS — working query: <exact query string used>` or
  `**Spike result:** FAIL — <one-line reason>`.

  **If PASS:** continue to Task 2 as written (full scope).
  **If FAIL:** skip the `link_customer_fields`-related parts of Tasks 2–6 as
  called out in each task below (tickets-only fallback) — proceed with
  everything else unchanged.

---

### Task 2: Database schema — unique index + two new tables

**Files:**
- Modify: `src/db/schema.sql:49` (insert after the existing
  `idx_customers_name_trgm` index, before the `-- Postman collections cache`
  comment)

**Interfaces:**
- Consumes: existing `customers` table (`customer_name` column).
- Produces: `link_customer_fields` (PK `customer_name`) and
  `link_customer_tasks` tables, both `ON DELETE CASCADE` on `customer_name`
  → `customers(customer_name)`. Later tasks read/write these by exact column
  names below.

- [ ] **Step 1: Add the migration SQL**

  Insert into `src/db/schema.sql` immediately after line 49
  (`CREATE INDEX IF NOT EXISTS idx_customers_name_trgm ...`):

  ```sql

  -- customer_name must be unique to be an FK target for the tables below.
  -- Verified no existing duplicates before adding this (see plan Task 2).
  CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_customer_name_unique
    ON customers (customer_name);

  -- Link (link.orangelogic.com) customer field cache — populated by a
  -- manual sync procedure, see docs/link-data-sync-runbook.md. The running
  -- app only ever reads this table; it never calls Link directly.
  CREATE TABLE IF NOT EXISTS link_customer_fields (
      customer_name    TEXT PRIMARY KEY REFERENCES customers(customer_name) ON DELETE CASCADE,
      ol_poc           TEXT,
      csm              TEXT,
      implementation   TEXT,
      sla_type         TEXT,
      weekend_upgrades BOOLEAN,
      modules          TEXT,
      prod_url         TEXT,
      test_url         TEXT,
      access_notes     TEXT,
      timezone         TEXT,
      launch_date      TEXT,
      is_live          BOOLEAN,
      synced_at        TIMESTAMPTZ NOT NULL
  );

  -- Link recent-tickets cache (rolling 14-day window) — same sync as above.
  CREATE TABLE IF NOT EXISTS link_customer_tasks (
      id              SERIAL PRIMARY KEY,
      customer_name   TEXT NOT NULL REFERENCES customers(customer_name) ON DELETE CASCADE,
      task_path       TEXT,
      task_type       TEXT,
      status          TEXT,
      total_minutes   INTEGER,
      teams           TEXT,
      synced_at       TIMESTAMPTZ NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_link_customer_tasks_customer_name
    ON link_customer_tasks (customer_name);
  ```

  **If Task 1's spike result was FAIL:** still add the unique index and the
  `link_customer_tasks` table, but skip the `link_customer_fields` table
  block entirely.

- [ ] **Step 2: Apply the migration**

  Run: `psql -d qa_dashboard -f src/db/schema.sql`
  Expected: no errors (the file is idempotent — safe to re-run even though
  most of it already exists).

- [ ] **Step 3: Verify the new tables exist with the right shape**

  Run: `psql -d qa_dashboard -c "\d link_customer_fields"` (skip if Task 1
  FAILed) and `psql -d qa_dashboard -c "\d link_customer_tasks"`
  Expected: each command prints the column list matching the DDL above,
  including a `Foreign-key constraints` line referencing `customers`.

- [ ] **Step 4: Verify cascade delete behavior**

  Run (this uses a transaction that's rolled back, so it leaves no trace):

  ```bash
  psql -d qa_dashboard <<'EOF'
  BEGIN;
  INSERT INTO customers (unique_id, customer_name) VALUES ('TEST-CASCADE-1', 'Cascade Test Co');
  INSERT INTO link_customer_tasks (customer_name, task_path, synced_at) VALUES ('Cascade Test Co', 'test', NOW());
  DELETE FROM customers WHERE customer_name = 'Cascade Test Co';
  SELECT COUNT(*) FROM link_customer_tasks WHERE customer_name = 'Cascade Test Co';
  ROLLBACK;
  EOF
  ```

  Expected: the `SELECT COUNT(*)` prints `0` (the task row cascaded away
  when the customer was deleted), then `ROLLBACK` undoes the whole test.

- [ ] **Step 5: Commit**

  ```bash
  git add src/db/schema.sql
  git commit -m "Add link_customer_fields and link_customer_tasks tables"
  ```

---

### Task 3: `scripts/write-link-data.js` — sync write path

**Files:**
- Create: `scripts/write-link-data.js`

**Interfaces:**
- Consumes: JSON on stdin, shape
  `{ customerName: string, fields?: {olPoc, csm, implementation, slaType,
  weekendUpgrades, modules, prodUrl, testUrl, accessNotes, timezone,
  launchDate, isLive} | null, tasks?: Array<{taskPath, taskType, status,
  totalMinutes, teams}> }`. `fields` is optional/nullable — omit it to sync
  tasks only (this is the mechanism the tickets-only fallback uses, and also
  what a per-customer partial failure during a real sync run would produce).
- Produces: rows in `link_customer_fields` and `link_customer_tasks` (from
  Task 2). Exit code `0` and a one-line stdout summary on success; exit code
  `1` and a stderr message on failure (invalid JSON, missing customerName,
  missing DB config, or a DB error) — Task 6's runbook loop relies on this
  exit code to detect per-customer failures.

- [ ] **Step 1: Write the script**

  Create `scripts/write-link-data.js`:

  ```js
  #!/usr/bin/env node
  /**
   * write-link-data.js — upserts one customer's synced Link data into Postgres.
   *
   * Usage: echo '<json>' | node scripts/write-link-data.js
   * See Task 3 of docs/superpowers/plans/2026-07-07-link-data-section.md
   * for the exact input JSON shape.
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

  const FIELD_COLUMNS = {
    olPoc: 'ol_poc',
    csm: 'csm',
    implementation: 'implementation',
    slaType: 'sla_type',
    weekendUpgrades: 'weekend_upgrades',
    modules: 'modules',
    prodUrl: 'prod_url',
    testUrl: 'test_url',
    accessNotes: 'access_notes',
    timezone: 'timezone',
    launchDate: 'launch_date',
    isLive: 'is_live',
  };

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
        const columns = ['customer_name', ...Object.values(FIELD_COLUMNS)];
        const values = [customerName, ...Object.keys(FIELD_COLUMNS).map(k => fields[k] ?? null)];
        const placeholders = values.map((_, i) => `$${i + 1}`);
        const updateSet = Object.values(FIELD_COLUMNS).map(c => `${c} = EXCLUDED.${c}`).join(', ');

        await pool.query(
          `INSERT INTO link_customer_fields (${columns.join(', ')}, synced_at)
           VALUES (${placeholders.join(', ')}, NOW())
           ON CONFLICT (customer_name) DO UPDATE SET ${updateSet}, synced_at = NOW()`,
          values
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

- [ ] **Step 2: Test the full-data path against a real seeded customer ("PMC")**

  ```bash
  echo '{"customerName":"PMC","fields":{"olPoc":"Jane Doe","csm":"John Smith","implementation":null,"slaType":"Gold","weekendUpgrades":true,"modules":"DAM,Search","prodUrl":"https://example.com","testUrl":"https://test.example.com","accessNotes":"VPN required","timezone":"America/New_York","launchDate":"2024-01-15","isLive":true},"tasks":[{"taskPath":"PMC > Support > Bug fix","taskType":"Defect","status":"Closed","totalMinutes":120,"teams":"Engineering"}]}' | node scripts/write-link-data.js
  ```

  Expected stdout: `Synced PMC: fields=yes, tasks=1`

  Verify: `psql -d qa_dashboard -c "SELECT customer_name, ol_poc, csm, synced_at FROM link_customer_fields WHERE customer_name='PMC';"`
  Expected: 1 row with `ol_poc = Jane Doe`.

  Verify: `psql -d qa_dashboard -c "SELECT task_path, total_minutes FROM link_customer_tasks WHERE customer_name='PMC';"`
  Expected: 1 row.

- [ ] **Step 3: Test the tasks-only path (fields omitted)**

  ```bash
  echo '{"customerName":"PMC","tasks":[]}' | node scripts/write-link-data.js
  ```

  Expected stdout: `Synced PMC: fields=no, tasks=0`

  Verify: `psql -d qa_dashboard -c "SELECT COUNT(*) FROM link_customer_tasks WHERE customer_name='PMC';"`
  Expected: `0` (the empty `tasks: []` cleared the prior row via the
  delete-then-insert). The `link_customer_fields` row from Step 2 is
  untouched (fields omission does not clear a previously-synced fields row)
  — this is expected, not a bug.

- [ ] **Step 4: Test invalid input**

  ```bash
  echo 'not json' | node scripts/write-link-data.js; echo "exit code: $?"
  ```

  Expected: stderr `Invalid JSON on stdin: ...` and `exit code: 1`.

- [ ] **Step 5: Clean up test data**

  ```bash
  psql -d qa_dashboard -c "DELETE FROM link_customer_fields WHERE customer_name='PMC'; DELETE FROM link_customer_tasks WHERE customer_name='PMC';"
  ```

  (So the dev DB doesn't show fabricated Link data for a real customer once
  Task 5's browser testing happens.)

- [ ] **Step 6: Commit**

  ```bash
  git add scripts/write-link-data.js
  git commit -m "Add write-link-data.js sync write path"
  ```

---

### Task 4: `GET /api/link-data/:customerName` route

**Files:**
- Modify: `scripts/dev-server.js:419` (insert right after the `PATCH
  /api/customers/:id` block ends, before the `// POST /api/run` comment)

**Interfaces:**
- Consumes: `link_customer_fields` and `link_customer_tasks` tables (Task 2)
  via the existing `pgPool` (already defined earlier in this file).
- Produces: `GET /api/link-data/:customerName` →
  `{ fields: {...} | null, tasks: [...], syncedAt: string | null }`, consumed
  by Task 5's frontend module.

- [ ] **Step 1: Add the route**

  Insert into `scripts/dev-server.js` immediately after line 419 (the closing
  `}` of the `PATCH /api/customers/:id` block) and before line 421's
  `// POST /api/run` comment:

  ```js

    // GET /api/link-data/:customerName — Link data cache, read-only
    const linkMatch = url.match(/^\/api\/link-data\/(.+)$/);
    if (linkMatch && req.method === 'GET') {
      const customerName = decodeURIComponent(linkMatch[1]);
      const { rows: fieldRows } = await pgPool.query(
        `SELECT ol_poc AS "olPoc", csm, implementation, sla_type AS "slaType",
                weekend_upgrades AS "weekendUpgrades", modules, prod_url AS "prodUrl",
                test_url AS "testUrl", access_notes AS "accessNotes", timezone,
                launch_date AS "launchDate", is_live AS "isLive", synced_at AS "syncedAt"
         FROM link_customer_fields WHERE customer_name = $1`,
        [customerName]
      );
      const { rows: taskRows } = await pgPool.query(
        `SELECT task_path AS "taskPath", task_type AS "taskType", status,
                total_minutes AS "totalMinutes", teams, synced_at AS "syncedAt"
         FROM link_customer_tasks WHERE customer_name = $1 ORDER BY total_minutes DESC NULLS LAST`,
        [customerName]
      );
      const fieldsRow = fieldRows[0] || null;
      const { syncedAt: fieldsSyncedAt, ...fields } = fieldsRow || {};
      return jsonResponse(res, 200, {
        fields: fieldsRow ? fields : null,
        tasks: taskRows.map(({ syncedAt, ...t }) => t),
        syncedAt: fieldsRow ? fieldsSyncedAt : (taskRows[0]?.syncedAt ?? null),
      });
    }
  ```

  (This works unchanged even if Task 1's spike FAILed and
  `link_customer_fields` was never created — that query would then error.
  **If spike FAILed**, delete the entire `fieldRows`/`fieldsRow` block above
  and hardcode `fields: null` in the returned object instead.)

- [ ] **Step 2: Restart the dev server**

  Run: `npm run dev` (kills and restarts on port 3000, per
  `scripts/restart-server.js`)

- [ ] **Step 3: Test the never-synced case**

  Run: `curl -s http://localhost:3000/api/link-data/PMC`
  Expected: `{"fields":null,"tasks":[],"syncedAt":null}`

- [ ] **Step 4: Test the synced case**

  Repeat Task 3 Step 2's `echo ... | node scripts/write-link-data.js` command
  to re-populate PMC, then:

  Run: `curl -s http://localhost:3000/api/link-data/PMC`
  Expected: a JSON object with `fields.olPoc == "Jane Doe"`, `tasks` an array
  with 1 entry, and `syncedAt` a non-null ISO timestamp string.

- [ ] **Step 5: Test URL-encoded customer names**

  Run: `curl -s "http://localhost:3000/api/link-data/A%26E%20Networks"`
  Expected: valid JSON (`{"fields":null,"tasks":[],"syncedAt":null}` — this
  customer was never synced), confirming `decodeURIComponent` handles `&`
  and spaces correctly rather than erroring.

- [ ] **Step 6: Clean up test data again**

  ```bash
  psql -d qa_dashboard -c "DELETE FROM link_customer_fields WHERE customer_name='PMC'; DELETE FROM link_customer_tasks WHERE customer_name='PMC';"
  ```

- [ ] **Step 7: Commit**

  ```bash
  git add scripts/dev-server.js
  git commit -m "Add GET /api/link-data/:customerName route"
  ```

---

### Task 5: Frontend — "Link Data" panel

**Files:**
- Modify: `src/index.html:191` (insert new panel between the closing `</div>`
  of `#client-summary` and `</main>`)
- Modify: `src/css/customer.css` (append two small rules for sub-panel
  spacing/headings)
- Create: `src/js/modules/linkData.js`
- Modify: `src/js/main.js` (import + call `initLinkData()`)

**Interfaces:**
- Consumes: `GET /api/link-data/:customerName` (Task 4); the
  `customer:selected` `CustomEvent` already dispatched by
  `selectCustomer()` in `src/js/modules/customerSelect.js:153`
  (`detail` is the full customer object, at minimum has `.customerName`).
- Produces: nothing consumed by later tasks — this is the last code task.

- [ ] **Step 1: Add the HTML panel**

  In `src/index.html`, replace the blank lines between line 191
  (`    </div>` — end of `#client-summary`) and line 194 (`  </main>`) with:

  ```html

      <!-- ── Link Data ── -->
      <div id="link-data-panel" class="panel">
        <div class="panel-header">
          <span class="panel-title">Link Data</span>
          <span class="panel-badge badge-cyan" id="link-data-synced">—</span>
        </div>

        <div class="ld-subpanel">
          <div class="ld-subpanel-title">Link Customer Fields</div>
          <div id="link-fields-grid" class="cs-grid"></div>
        </div>

        <div class="ld-subpanel">
          <div class="ld-subpanel-title">Recent Link Tickets</div>
          <div class="ct-table-wrap">
            <table id="link-tasks-table">
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Minutes</th>
                  <th>Teams</th>
                </tr>
              </thead>
              <tbody id="link-tasks-tbody">
                <tr><td colspan="5"><div class="empty-state"><div class="empty-title">Never synced</div></div></td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

  ```

  **If Task 1's spike FAILed**, omit the entire `.ld-subpanel` block for
  "Link Customer Fields" (keep only the "Recent Link Tickets" sub-panel).

- [ ] **Step 2: Add sub-panel CSS**

  Append to `src/css/customer.css`:

  ```css

  .ld-subpanel + .ld-subpanel { margin-top: 1.5rem; }
  .ld-subpanel-title {
    font-family: var(--font-mono);
    font-size: 0.75rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    opacity: 0.65;
    margin-bottom: 0.75rem;
  }
  ```

- [ ] **Step 3: Create the frontend module**

  Create `src/js/modules/linkData.js`:

  ```js
  /**
   * linkData.js — renders the "Link Data" panel for the selected customer.
   * Reads only from /api/link-data/:customerName; never talks to Link directly.
   */

  const FIELD_LABELS = [
    ['olPoc',           'OL POC'],
    ['csm',             'Customer Success Manager'],
    ['implementation',  'Implementation Partner'],
    ['slaType',         'SLA Type'],
    ['weekendUpgrades', 'Weekend Upgrades'],
    ['modules',         'Purchased Modules'],
    ['prodUrl',         'Production URL'],
    ['testUrl',         'Test URL'],
    ['accessNotes',     'Access Notes'],
    ['timezone',        'Timezone'],
    ['launchDate',      'Launch Date'],
    ['isLive',          'Launched'],
  ];
  const BOOLEAN_FIELDS = new Set(['weekendUpgrades', 'isLive']);

  function fieldValueText(key, value) {
    if (BOOLEAN_FIELDS.has(key)) return value == null ? '—' : (value ? 'Yes' : 'No');
    return value || '—';
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
    FIELD_LABELS.forEach(([key, label]) => {
      const field = document.createElement('div');
      field.className = 'cs-field';
      const labelEl = document.createElement('span');
      labelEl.className = 'cs-label';
      labelEl.textContent = label;
      const valueEl = document.createElement('span');
      valueEl.className = 'cs-value';
      valueEl.textContent = fieldValueText(key, fields[key]);
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
      [t.taskPath, t.taskType, t.status, t.totalMinutes ?? '—', t.teams].forEach(text => {
        const td = document.createElement('td');
        td.textContent = text || '—';
        tr.appendChild(td);
      });
      return tr;
    }));
  }

  function formatSyncedAt(iso) {
    return iso ? new Date(iso).toLocaleString() : null;
  }

  async function loadLinkData(customer) {
    const syncBadge = document.getElementById('link-data-synced');
    const fieldsGrid = document.getElementById('link-fields-grid');
    const tasksBody  = document.getElementById('link-tasks-tbody');
    if (!syncBadge || !tasksBody) return;

    if (customer.customerName.startsWith('QA-')) {
      syncBadge.textContent = 'Not synced (excluded)';
      if (fieldsGrid) renderFields(fieldsGrid, null);
      renderTasks(tasksBody, []);
      return;
    }

    try {
      const resp = await fetch(`/api/link-data/${encodeURIComponent(customer.customerName)}`);
      if (!resp.ok) throw new Error(`Link data API error: ${resp.status}`);
      const data = await resp.json();
      syncBadge.textContent = data.syncedAt ? `Last synced: ${formatSyncedAt(data.syncedAt)}` : 'Never synced';
      if (fieldsGrid) renderFields(fieldsGrid, data.fields);
      renderTasks(tasksBody, data.tasks || []);
    } catch (err) {
      console.warn('Link data unavailable:', err.message);
      syncBadge.textContent = 'Never synced';
      if (fieldsGrid) renderFields(fieldsGrid, null);
      renderTasks(tasksBody, []);
    }
  }

  export function initLinkData() {
    document.addEventListener('customer:selected', e => loadLinkData(e.detail));
  }
  ```

  (The `if (fieldsGrid)` guards make this file work unchanged whether or not
  Task 1's spike FAILed and the fields sub-panel was omitted from the HTML.)

- [ ] **Step 4: Wire it into `main.js`**

  In `src/js/main.js`, add the import alongside the existing module imports:

  ```js
  import { initLinkData } from './modules/linkData.js';
  ```

  And add the call right after `initClientSelects();` inside the
  `DOMContentLoaded` handler:

  ```js
    initClientSelects();
    initLinkData();
  ```

- [ ] **Step 5: Seed test data for browser verification**

  ```bash
  echo '{"customerName":"PMC","fields":{"olPoc":"Jane Doe","csm":"John Smith","implementation":null,"slaType":"Gold","weekendUpgrades":true,"modules":"DAM,Search","prodUrl":"https://example.com","testUrl":"https://test.example.com","accessNotes":"VPN required","timezone":"America/New_York","launchDate":"2024-01-15","isLive":true},"tasks":[{"taskPath":"PMC > Support > Bug fix","taskType":"Defect","status":"Closed","totalMinutes":120,"teams":"Engineering"}]}' | node scripts/write-link-data.js
  ```

- [ ] **Step 6: Verify in a real browser with agent-browser**

  ```bash
  agent-browser open http://localhost:3000/index.html
  agent-browser wait --load networkidle
  agent-browser find text "PMC" click
  agent-browser wait --text "Last synced"
  agent-browser snapshot -i -s "#link-data-panel"
  ```

  Expected: the snapshot shows the "Link Data" panel with badge text
  starting `Last synced:`, an "OL POC" field with value "Jane Doe", and a
  ticket row containing "PMC > Support > Bug fix".

  Then test the excluded-customer state:

  ```bash
  agent-browser find text "QA-Queenstown" click
  agent-browser wait --text "Not synced (excluded)"
  ```

  Expected: wait succeeds (text appears).

  Then test the never-synced state on a different, never-synced real
  customer (e.g. "Pinterest"):

  ```bash
  agent-browser find text "Pinterest" click
  agent-browser wait --text "Never synced"
  agent-browser console
  agent-browser errors
  ```

  Expected: wait succeeds, and both `console` and `errors` print nothing.

  ```bash
  agent-browser close
  ```

- [ ] **Step 7: Clean up test data**

  ```bash
  psql -d qa_dashboard -c "DELETE FROM link_customer_fields WHERE customer_name='PMC'; DELETE FROM link_customer_tasks WHERE customer_name='PMC';"
  ```

- [ ] **Step 8: Commit**

  ```bash
  git add src/index.html src/css/customer.css src/js/modules/linkData.js src/js/main.js
  git commit -m "Add Link Data panel to the Customers page"
  ```

---

### Task 6: Sync runbook documentation

**Superseded:** the actual sync procedure lives in
`docs/link-data-sync-runbook.md` — follow that file, not the code sample
below, which predates two bugs found and fixed during Task 6's live dry-run
(`.type`→`subType` field mapping, de-dup by `taskId`).

**Files:**
- Create: `docs/link-data-sync-runbook.md`

**Interfaces:**
- Consumes: the `orangelogic-foundation` MCP tools `SearchTask` and
  `GetCustomerRecentWork`, `GET /api/customers` (existing route), and
  `scripts/write-link-data.js` (Task 3).
- Produces: nothing consumed by other tasks — this is the last task in the
  plan. Its content is what a human (or Claude, when asked) follows to
  actually populate real Link data.

- [ ] **Step 1: Write the runbook**

  Create `docs/link-data-sync-runbook.md`:

  ```markdown
  # Link Data Sync Runbook

  Manually syncs Link (link.orangelogic.com) data into the
  `link_customer_fields` / `link_customer_tasks` Postgres tables that back
  the Customers page's "Link Data" panel. Run this from a Claude Code
  session with the `orangelogic-foundation` MCP plugin enabled — the running
  app cannot do this itself (no server-side Link auth). Not scheduled; run
  it whenever you want fresher data.

  ## Procedure

  1. `GET /api/customers` (or `psql -d qa_dashboard -c "SELECT customer_name FROM customers ORDER BY customer_name;"`)
     to get the full customer list.
  2. Drop any customer whose name starts with `QA-` — these are excluded
     from the sync.
  3. For each remaining customer:
     a. Call `SearchTask` with the query pattern validated in Task 1's
        spike (recorded at the top of
        `docs/superpowers/plans/2026-07-07-link-data-section.md`), swapping
        in this customer's name.
        <!-- If Task 1's spike FAILed, skip this step entirely — fields stays omitted for every customer. -->
     b. Call `GetCustomerRecentWork` with `customer: "<name>"`,
        `time_start`: 14 days before today (ISO 8601), `time_end`: today
        (ISO 8601).
     c. Build the JSON payload:
        `{"customerName": "<name>", "fields": <mapped fields from 3a, or omit/null>, "tasks": [<mapped tasks from 3b>]}`
        — map `GetCustomerRecentWork`'s `tasks[].path` → `taskPath`,
        `.type` → `taskType`, `.status` → `status`,
        `.totalMinutes` → `totalMinutes`, `.teams` → `teams`.
     d. Pipe it in: `echo '<json>' | node scripts/write-link-data.js`
     e. If that command exits non-zero, record `<name>` as failed and
        continue to the next customer — do not stop the whole run.
  4. At the end, report how many customers synced successfully and list any
     that failed, with their error messages.

  ## Notes

  - This is a snapshot sync — each customer's rows are fully replaced, not
    accumulated as history.
  - `link_customer_fields` may not exist if Task 1's spike failed; in that
    case this runbook only performs steps 3b–3d (tickets).
  ```

- [ ] **Step 2: Dry-run one real customer end to end**

  Using a real, non-`QA-` customer of your choice, actually perform steps
  3a–3d of the runbook using the live MCP tools (not sample/hand-crafted
  JSON this time). This is the first real, non-simulated exercise of the
  whole pipeline.

  Verify: `curl -s http://localhost:3000/api/link-data/<that customer's name>`
  Expected: real data appears (not the hand-crafted "Jane Doe" test fixture
  used in earlier tasks) with a current `syncedAt` timestamp.

- [ ] **Step 3: Commit**

  ```bash
  git add docs/link-data-sync-runbook.md
  git commit -m "Add Link data sync runbook"
  ```

---

## If Task 1's spike result was FAIL (tickets-only fallback summary)

For quick reference, the fallback touches these specific spots (each is also
called out inline above):
- Task 2, Step 1: skip the `link_customer_fields` table block.
- Task 4, Step 1: delete the `fieldRows`/`fieldsRow` logic, hardcode
  `fields: null`.
- Task 5, Step 1: omit the "Link Customer Fields" `.ld-subpanel` from the
  HTML.
- Task 6, Step 1: the runbook's step 3a is skipped for every customer.

Nothing else changes — `link_customer_tasks`, `write-link-data.js`'s
tasks-only path, and the "Recent Link Tickets" sub-panel are unaffected by
either outcome.
