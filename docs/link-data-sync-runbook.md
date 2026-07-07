# Link Data Sync Runbook

Manually syncs Link (link.orangelogic.com) ticket data into the
`link_customer_tasks` Postgres table that backs the Customers page's "Link
Data" panel. Run this from a Claude Code session with the
`orangelogic-foundation` MCP plugin enabled — the running app cannot do this
itself (no server-side Link auth). Not scheduled; run it whenever you want
fresher data.

**Note:** Link Customer-record fields (SLA type, hosting info, etc.) are not
synced in this build — Task 1's spike (see
`docs/superpowers/plans/2026-07-07-link-data-section.md`) found no reliable
query pattern for them. This runbook only syncs recent tickets.

## Procedure

1. `GET /api/customers` (or `psql -d qa_dashboard -c "SELECT customer_name FROM customers ORDER BY customer_name;"`)
   to get the full customer list.
2. Drop any customer whose name starts with `QA-` — these are excluded
   from the sync.
3. For each remaining customer:
   a. Call `GetCustomerRecentWork` with `customer: "<name>"`,
      `time_start`: 14 days before today (ISO 8601), `time_end`: today
      (ISO 8601).
   b. `GetCustomerRecentWork` has been observed to return every task twice
      in the `tasks` array with identical `taskId`s (e.g. `totalTasks: 20`
      but `returned: 40`). Before building the payload, de-duplicate
      `tasks` by `taskId`, keeping one copy of each unique `taskId`.
      Build the JSON payload:
      `{"customerName": "<name>", "tasks": [<mapped, de-duplicated tasks>]}`
      — map the de-duplicated `tasks[].path` → `taskPath`,
      `.subType` → `taskType` (the tool's response field is `subType`, not
      `type`; it may be `null`), `.status` → `status`,
      `.totalMinutes` → `totalMinutes`, `.teams` → `teams`.

      If `teams` comes back as an array rather than a string, join it with
      ", " before including it in the payload. `totalMinutes` should be a
      plain integer; coerce with `Number(...)` if the tool returns it as a
      string.
   c. Pipe it in: `echo '<json>' | node scripts/write-link-data.js`
   d. If that command exits non-zero, record `<name>` as failed and
      continue to the next customer — do not stop the whole run.
4. At the end, report how many customers synced successfully and list any
   that failed, with their error messages.

## Notes

- This is a snapshot sync — each customer's rows are fully replaced, not
  accumulated as history.
- Link Customer-record fields (`link_customer_fields`) are out of scope for
  this build — see Task 1's spike result in the implementation plan.
