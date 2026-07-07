# Link Data Section — Design

**Date:** 2026-07-07
**Status:** Approved by user, pending implementation plan

## Summary

Add a "Link Data" section to the Customers page (`src/index.html`) that shows
data from Orange Logic Link (link.orangelogic.com) for the currently selected
customer: a curated set of Link Customer-record fields, and a list of that
customer's recent Link tickets/tasks. Data is populated by a manually
triggered sync (run from a Claude Code session) into two new Postgres tables;
the running app only ever reads from Postgres, never calls Link directly.

## 1. Architecture & data flow

`dev-server.js` cannot authenticate to Link itself (Link's Search v4.0 API
requires interactive OAuth2/SSO, which only works inside a Claude Code
session via the `orangelogic-foundation` MCP plugin). The sync is therefore
decoupled from the running app and triggered manually, on demand, by asking
Claude Code to run it — not a background cron, not something the Node server
does on its own.

```
[You, in Claude Code] → "sync Link data"
    → spike check (LookupModuleId + SearchTask, 2-3 known real customers)
    → batch: for each customer in Postgres, excluding names starting with "QA-"
          → SearchTask (curated fields) + GetCustomerRecentWork (14-day tickets)
          → pipe result JSON into scripts/write-link-data.js (upserts to Postgres)
[Browser] → dev-server.js: GET /api/link-data/:customerName (Postgres read only)
    → renders "Link Data" section: curated fields + recent tickets + "last synced" timestamp
```

The UI always shows the last-synced snapshot, never a live call — the "last
synced" timestamp is the only staleness signal (no automatic drift/staleness
warnings, per explicit decision below).

## 2. Data model

Two new Postgres tables, keyed by `customer_name` (matching the existing
`customers.customer_name`), both with `ON DELETE CASCADE` on that FK so rows
clean up automatically if a customer is removed from the `customers` table.

```sql
CREATE TABLE IF NOT EXISTS link_customer_fields (
    customer_name    TEXT PRIMARY KEY REFERENCES customers(customer_name) ON DELETE CASCADE,
    ol_poc           TEXT,     -- RelatedValue.Customer-POC
    csm              TEXT,     -- RelatedValue.Customer-Success-Manager
    implementation   TEXT,     -- customer.Implementation-Partner
    sla_type         TEXT,     -- customer.SLA-Contract-Type
    weekend_upgrades BOOLEAN,  -- Customer.Can-upgrade-over-any-weekend?
    modules          TEXT,     -- Customer.Purchased-Modules
    prod_url         TEXT,     -- customer.Primary-Production-URL
    test_url         TEXT,     -- customer.Test-URL
    access_notes     TEXT,     -- customer.Authorized-Access-Notes
    timezone         TEXT,     -- InheritedValue.Customer-Timezone
    launch_date      TEXT,     -- Customer.Launch-Date
    is_live          BOOLEAN,  -- customer.Is-live?
    synced_at        TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS link_customer_tasks (
    id              SERIAL PRIMARY KEY,
    customer_name   TEXT NOT NULL REFERENCES customers(customer_name) ON DELETE CASCADE,
    task_path       TEXT,     -- last 3 levels of hierarchy, per GetCustomerRecentWork
    task_type       TEXT,
    status          TEXT,
    total_minutes   INTEGER,
    teams           TEXT,     -- comma-separated department labels
    synced_at       TIMESTAMPTZ NOT NULL
);
```

Each sync run replaces a customer's rows (delete-then-insert or upsert) —
this is a current-snapshot cache, not a history/time-series table.

### Field mapping rationale

The 12 curated fields were chosen because they correspond to fields already
shown in the existing Customer Summary panel (OL POC, CSM, Implementation,
SLA Type, Weekend Upgrades, Modules, Production/Test URL, Access Notes,
Timezone, Launch Date, Launched), deliberately re-sourced from Link rather
than the local `customers` table — the explicit goal (per user decision) is
to make Link the visible source of truth for these fields alongside the
existing locally-entered values, for drift visibility. **No automatic
mismatch highlighting** is included (explicit decision — see Section 5); the
user will eyeball differences manually.

Existing local fields with **no clean Link equivalent** found in Link's
field catalog (231 Customer/client-related fields surveyed via
`ListAllNames(type="fields")`) are excluded from this section rather than
guessed at: PM, KB Article, Release/Release Name, UAT/INT/PPE/Stage URLs,
CSAT score.

## 3. Sync mechanism

**Spike (run once, before building the batch sync):** manually run
`LookupModuleId` for the Customer/Account module, then a single `SearchTask`
call scoped to that module against 2-3 known **real** customers (e.g.
"Pinterest", "PMC", "ACLU" — not `QA-`-prefixed test customers), requesting
the 12 curated fields. If it cleanly returns one record per customer with
sane values, proceed with the full design below. **If it fails or the query
pattern doesn't work**, drop the curated-fields sub-section for this version
and ship tickets-only (the `link_customer_fields` table and its API/UI
simply aren't built yet) — this is an explicit fallback, not a blocker.

**Batch loop:** iterate customers from `/api/customers`, **excluding any
customer whose name starts with `QA-`** (internal/test seed customers, e.g.
"QA-Queenstown"). For each remaining customer: call `SearchTask` for the
curated fields and `GetCustomerRecentWork` (last 14 days) for tickets.

**Write path:** a new script, `scripts/write-link-data.js`, following the
existing pattern of standalone scripts (`dev-server.js`, `build.js`,
`deploy.js`). It reads JSON from stdin
(`{ customerName, fields: {...}, tasks: [...] }`), connects using the same
`qa-dashboard.config.json` DB config as the rest of the app, and performs a
**parameterized** upsert into both tables. Centralizing this in one script
avoids hand-building SQL strings per customer inline (injection/escaping
risk) during the sync loop.

**Trigger:** no formal Claude Code skill file. This is a one-off internal
procedure the user invokes by asking Claude directly ("sync Link data for
all customers") in a session; Claude follows the documented procedure above
using the existing `orangelogic-foundation` MCP tools plus
`write-link-data.js`. Can be formalized into a skill later if run often
enough to warrant it (YAGNI for now).

**Per-customer failure handling during a batch run:** skip and continue,
don't abort the whole batch (see Section 5).

## 4. API + Frontend UI

**New API route**, in `dev-server.js` alongside the existing `/api/customers`
etc.:

```
GET /api/link-data/:customerName
→ { fields: {...} | null, tasks: [...], syncedAt: "2026-07-07T..." | null }
```

`fields: null`, empty `tasks`, and `syncedAt: null` together signal "never
synced" — distinct from "synced but genuinely empty."

**Frontend:** a new `<div class="panel" id="link-data-panel">` in
`index.html`, placed after the existing Customer Summary panel, titled
"Link Data" with a "Last synced: `<timestamp>`" badge (or "Never synced" /
"Not synced (excluded)" — see Section 5). Two sub-panels:

- **Link Customer Fields** — the 12 curated fields, reusing the existing
  `cs-grid`/`cs-field` visual style from the Customer Summary panel.
- **Recent Link Tickets** — a table (path, type, status, time spent, teams)
  from the last synced 14-day `GetCustomerRecentWork` window.

Driven by a new function (in `customerSelect.js` or a small new module)
firing on `selectCustomer()`, fetching `/api/link-data/:customerName` and
rendering both sub-panels.

## 5. Error handling & edge cases

- **Never synced yet**: nulls from the API → "Never synced" empty state in
  both sub-panels (not an error state).
- **Excluded customer (`QA-` prefix)**: UI shows "Not synced (excluded)" —
  distinguishes intentional exclusion from a sync that simply hasn't run.
- **Spike fails**: curated-fields sub-section is omitted from this version
  entirely (ships tickets-only), per the agreed fallback.
- **Per-customer failure during a batch sync run** (Link record not found,
  auth expired mid-run, etc.): skip that customer, continue the loop; report
  a summary of skipped/failed customers at the end of the run — not silent.
- **`write-link-data.js` failure** (DB down, malformed input): non-zero exit
  with a clear error for that customer; treated the same as a fetch failure
  by the batch loop (log and continue).
- **Customer deleted from `customers` table**: `ON DELETE CASCADE` on both
  new tables' FK cleans up Link data rows automatically — no orphans.
- **No automatic staleness/drift warnings**: explicit decision — the UI only
  shows the plain "last synced" timestamp; no logic comparing Link values
  against the local `customers` table or flagging staleness.

## Explicit decisions (for future reference)

- Sync trigger: manual/on-demand via Claude Code, not scheduled.
- Sync scope: all customers in one batch run, not one-at-a-time.
- Ticket window: rolling 14 days (single `GetCustomerRecentWork` call per
  customer), not a longer accumulated history.
- Overlapping fields are deliberately re-shown from Link (not deduplicated
  against the Customer Summary panel) — the point is visible drift, but
  **without** automatic mismatch highlighting.
- `QA-`-prefixed customers are excluded from sync entirely.

## Out of scope for this version

- Live/real-time Link queries from the browser or `dev-server.js`.
- Scheduled/automatic sync.
- Automatic drift/mismatch highlighting between Link and local values.
- Any local field without a confirmed Link equivalent (PM, KB Article,
  Release, UAT/INT/PPE/Stage URLs, CSAT score).
- A formal Claude Code skill file for the sync procedure.
