# Link Data Sync Runbook

Manually syncs Link (link.orangelogic.com) ticket data into the
`link_customer_tasks` Postgres table that backs the Customers page's "Link
Data" panel. Run this from a Claude Code session with the
`orangelogic-foundation` MCP plugin enabled — the running app cannot do this
itself (no server-side Link auth). Not scheduled; run it whenever you want
fresher data.

Also syncs Link's raw per-customer account/profile data into
`link_customer_fields` (JSONB, uncurated — whatever `GetTaskDetail`'s
`parent_task` returns, stored verbatim). See
`docs/superpowers/specs/2026-07-08-link-customer-fields-revival-design.md`.

## Procedure

1. `GET /api/customers` (or `psql -d qa_dashboard -c "SELECT customer_name FROM customers ORDER BY customer_name;"`)
   to get the full customer list.
2. Drop any customer whose name starts with `QA-` — these are excluded
   from the sync.
3. For each remaining customer:
   a. Call `GetCustomerRecentWork` with `customer: "<name>"`,
      `time_start`: 14 days before today (ISO 8601), `time_end`: today
      (ISO 8601).
   b. Pick an anchor ticket for the fields lookup: if step 3a returned at
      least one task, use its `taskId`. If it returned zero tasks, call
      `SearchTask` with `query: "<name>"`, `is_semantic: true`,
      `page_size: 5`, and use the top result's `SystemIdentifier` as the
      anchor instead (validated reliable — see Task 1 of
      `docs/superpowers/plans/2026-07-08-link-customer-fields-revival.md`,
      confirmed via URL cross-check against two customers with no recent
      tickets).
   c. Call `GetTaskDetail(anchor ticket ID)`. If the response has a
      `parent_task` object, that is the customer's `fields` value
      (verbatim, no transformation). If there is no `parent_task`, omit
      `fields` for this customer this run.
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
4. At the end, report how many customers synced successfully and list any
   that failed, with their error messages.

## Notes

- This is a snapshot sync — each customer's rows are fully replaced, not
  accumulated as history.
- `fields` is stored as-is with no curation — expect 60-100+ keys per
  customer, varying in shape depending on which record type the anchor
  ticket's parent happens to be (Support Case, Epic, Platform Deployment,
  etc.). This is a deliberate design choice, not a bug.
