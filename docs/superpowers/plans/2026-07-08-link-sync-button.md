# Link Data Panel "Copy Sync Command" Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Copy Sync Command" button to the Customers page's Link Data
panel that copies a ready-to-paste Claude Code prompt for syncing the
selected customer's Link data — a clipboard convenience, not a real sync.

**Architecture:** Entirely client-side. One new button in `src/index.html`'s
existing Link Data panel header, one new CSS rule reusing the existing
`.cs-btn` button style, and new logic inside the already-existing
`src/js/modules/linkData.js` module (which already tracks per-customer
panel state via the `customer:selected` event). No API routes, no secrets,
no server changes.

**Tech Stack:** Vanilla JS (ES modules), `navigator.clipboard` API. No test
framework exists in this repo (confirmed in `CLAUDE.md`) — verification is
via `agent-browser` against the real running dev server.

## Global Constraints

- No real Link sync of any kind is triggered by this button — it only
  copies text to the clipboard (or falls back to `window.prompt`). This is
  an explicit, deliberate limitation per the approved design spec
  (`docs/superpowers/specs/2026-07-08-link-sync-button-design.md`) — there
  is no headless Link auth available, so a real sync from the browser is
  not possible.
- Button label must read "Copy Sync Command", never "Sync" — must not imply
  the button performs a sync itself.
- Copied text must be exactly:
  `Sync Link data for customer "<customerName>" (single customer only) per docs/link-data-sync-runbook.md.`
  with the real, unescaped customer name substituted for `<customerName>`.
- Button is `disabled` when no customer is selected, and `disabled` when
  the selected customer's name starts with `QA-` (permanently excluded from
  sync per the original Link Data feature).
- No changes to `docs/link-data-sync-runbook.md`'s procedure, no changes to
  batch/all-customer sync — out of scope.
- Reference spec: `docs/superpowers/specs/2026-07-08-link-sync-button-design.md`.

---

### Task 1: Add the "Copy Sync Command" button

This is a single, self-contained task — the feature is small enough (one
button, one existing module, no backend) that splitting it further would
create artificial task boundaries with nothing independently testable
between them.

**Files:**
- Modify: `src/index.html:194-199` (Link Data panel header)
- Modify: `src/css/customer.css` (append one new rule)
- Modify: `src/js/modules/linkData.js` (full file shown below — small
  enough to replace in one step rather than diff piecemeal)

**Interfaces:**
- Consumes: `getSelectedCustomer()`, already exported from
  `src/js/modules/customerSelect.js` (returns the currently selected
  customer object, or `null` if none — this repo's existing pattern for
  cross-module access to selection state; `_selected` is assigned there
  *before* the `customer:selected` event is dispatched, so it's always
  current by the time this module's listener runs).
- Produces: nothing consumed by other modules — this is a leaf feature.

- [ ] **Step 1: Update the Link Data panel header HTML**

  In `src/index.html`, replace lines 194-199:

  ```html
      <!-- ── Link Data ── -->
      <div id="link-data-panel" class="panel">
        <div class="panel-header">
          <span class="panel-title">Link Data</span>
          <span class="panel-badge badge-cyan" id="link-data-synced">—</span>
        </div>
  ```

  with:

  ```html
      <!-- ── Link Data ── -->
      <div id="link-data-panel" class="panel">
        <div class="panel-header">
          <span class="panel-title">Link Data</span>
          <div class="ld-header-right">
            <button type="button" class="cs-btn" id="link-data-sync-btn" disabled>Copy Sync Command</button>
            <span class="panel-badge badge-cyan" id="link-data-synced">—</span>
          </div>
        </div>
  ```

  (The rest of the panel — the "Recent Link Tickets" sub-panel starting at
  line 201 — is unchanged.)

  The button starts `disabled` in the HTML itself, covering the "no
  customer selected yet" state before any `customer:selected` event has
  fired (e.g. the brief window during initial page load).

- [ ] **Step 2: Add the header-right layout CSS**

  `src/index.html`'s `.panel-header` uses `justify-content: space-between`
  with exactly 2 direct children today; adding a 3rd would spread all three
  evenly instead of grouping the button with the badge. Wrapping them (done
  in Step 1) needs a flex rule, mirroring the existing `.ct-header-right`
  pattern used by the Customers panel. Append to `src/css/customer.css`:

  ```css

  .ld-header-right {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  ```

- [ ] **Step 3: Replace `src/js/modules/linkData.js` with the updated version**

  Full file (adds `updateSyncButton`, `copySyncCommand`, the
  `getSelectedCustomer` import, and the click listener; `renderTasks` and
  `formatSyncedAt` are unchanged from the current file):

  ```js
  /**
   * linkData.js — renders the "Link Data" panel for the selected customer.
   * Reads only from /api/link-data/:customerName; never talks to Link directly.
   *
   * Note: Link Customer-record fields are not synced in this build (Task 1's
   * spike found no reliable query pattern for them) — this module only
   * renders the recent-tickets sub-panel.
   */

  import { getSelectedCustomer } from './customerSelect.js';

  const COPY_LABEL = 'Copy Sync Command';
  const COPIED_LABEL = 'Copied!';
  const COPIED_RESET_MS = 1500;

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
    const tasksBody = document.getElementById('link-tasks-tbody');
    if (!syncBadge || !tasksBody) return;

    if (customer.customerName.startsWith('QA-')) {
      syncBadge.textContent = 'Not synced (excluded)';
      renderTasks(tasksBody, []);
      return;
    }

    try {
      const resp = await fetch(`/api/link-data/${encodeURIComponent(customer.customerName)}`);
      if (!resp.ok) throw new Error(`Link data API error: ${resp.status}`);
      const data = await resp.json();
      syncBadge.textContent = data.syncedAt ? `Last synced: ${formatSyncedAt(data.syncedAt)}` : 'Never synced';
      renderTasks(tasksBody, data.tasks || []);
    } catch (err) {
      console.warn('Link data unavailable:', err.message);
      syncBadge.textContent = 'Never synced';
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

- [ ] **Step 4: Restart the dev server**

  Run: `npm run dev`

- [ ] **Step 5: Verify the enabled/clipboard-success path with agent-browser**

  ```bash
  agent-browser open http://localhost:3000/index.html
  agent-browser wait --load networkidle
  agent-browser find text "PMC" click
  agent-browser wait --text "Copy Sync Command"
  agent-browser snapshot -i -s "#link-data-panel"
  ```

  Expected: the snapshot shows an **enabled** button labeled "Copy Sync
  Command" inside `#link-data-panel` (PMC is a real, non-`QA-` seeded
  customer).

  Click it and verify the clipboard content directly (not just the visual
  label change):

  ```bash
  agent-browser find text "Copy Sync Command" click
  agent-browser wait --text "Copied!"
  agent-browser eval "navigator.clipboard.readText()"
  ```

  Expected: the eval result is exactly
  `Sync Link data for customer "PMC" (single customer only) per docs/link-data-sync-runbook.md.`

  Then verify the label reverts:

  ```bash
  agent-browser wait 2000
  agent-browser get text "#link-data-sync-btn"
  ```

  Expected: `Copy Sync Command` (reverted from "Copied!" after ~1.5s).

- [ ] **Step 6: Verify the disabled state for excluded (`QA-`) customers**

  ```bash
  agent-browser find text "QA-Queenstown" click
  agent-browser wait --text "Not synced (excluded)"
  agent-browser eval "document.getElementById('link-data-sync-btn').disabled"
  ```

  Expected: `true`.

- [ ] **Step 7: Verify the clipboard-failure fallback path**

  With "PMC" selected again (`agent-browser find text "PMC" click`, then
  `agent-browser wait --text "Copy Sync Command"`), inject a failing
  clipboard and a capturing `window.prompt`, then click the button:

  ```bash
  cat <<'EOF' | agent-browser eval --stdin
  window.__promptCalls = [];
  window.prompt = (msg, text) => { window.__promptCalls.push([msg, text]); return null; };
  navigator.clipboard.writeText = () => Promise.reject(new Error('simulated failure'));
  'injected'
  EOF
  agent-browser find text "Copy Sync Command" click
  agent-browser eval "window.__promptCalls"
  ```

  Expected: `window.__promptCalls` has exactly one entry:
  `["Copy this into a Claude Code session:", "Sync Link data for customer \"PMC\" (single customer only) per docs/link-data-sync-runbook.md."]`

- [ ] **Step 8: Confirm no console/page errors across the whole test**

  ```bash
  agent-browser console
  agent-browser errors
  agent-browser close
  ```

  Expected: both empty. (The injected `console.warn` from Step 7's
  simulated failure is expected application behavior, not an error — if it
  appears in `agent-browser console`, confirm it's a `warn`-level log with
  the exact "Clipboard write failed, falling back to prompt:" text, not an
  uncaught exception.)

- [ ] **Step 9: Commit**

  ```bash
  git add src/index.html src/css/customer.css src/js/modules/linkData.js
  git commit -m "Add Copy Sync Command button to the Link Data panel"
  ```

---

## Self-Review

**Spec coverage:** every requirement in
`docs/superpowers/specs/2026-07-08-link-sync-button-design.md` maps to a
step above — placement/style (Step 1-2), label/copy text (Step 3, verified
Step 5), disabled states (Step 3, verified Steps 5-6), clipboard
success+revert (Step 3, verified Step 5), clipboard failure fallback (Step
3, verified Step 7), out-of-scope items (no runbook changes, no batch sync
changes, no automation) are correctly absent from every step.

**Placeholder scan:** none found — every step has literal code/commands and
concrete expected output.

**Type consistency:** `getSelectedCustomer()`'s return shape (`{customerName, ...}`
or `null`) matches how it's already used in `customerSelect.js` and how
`copySyncCommand()` consumes it here (`customer.customerName`, guarded by
`if (!customer) return;`).
