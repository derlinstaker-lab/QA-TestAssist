# Link Customer Fields — Revival Design

**Date:** 2026-07-08
**Status:** Approved by user, pending implementation plan

## Summary

Revive the "Link Customer Fields" sub-panel of the Customers page's Link
Data panel, dropped in the original design
(`docs/superpowers/specs/2026-07-07-link-data-section-design.md`) after its
Task 1 spike found no reliable way to query Link's per-customer field data.
A follow-up investigation this session found a different, verified-reliable
method. This design captures the *entire* raw per-customer data snapshot
that method returns (no curated field list), stores it as JSONB, and
displays it as a dynamic key/value list.

## Why the original approach failed and this one works

The original spike queried `SearchTask` with a `Customer.Customer-Name:"<name>"`
field-value filter — that returns ticket-scoped noise (dozens of unrelated
rows, or a single row with only ~33% of fields populated). That conclusion
is still correct for that technique.

The new method: call `GetTaskDetail(ticket_id)` on **any known ticket**
belonging to a customer. The response's `parent_task` object contains
60-100+ `InheritedValue.*`/`RelatedValue.*` fields — resolved, customer-level
account/profile data inherited down through the ticket hierarchy, not
per-ticket noise.

**Verified this session, 3 real customers:**
- **Canadian Press** — tested via 2 unrelated tickets from different
  branches of its hierarchy; both returned identical CSM, SLA contract
  type, prod/test URLs, current releases, hosting account owner, live
  status. Confirms these are stable customer-level values, not per-ticket
  noise.
- **Pinterest** — test URL from this method exactly matched the value
  already in the local `customers` Postgres table (independent cross-check).
- **Walmart** (a customer in "Implementation" status, not yet live) —
  `InheritedValue.Inherited-Customer-Status` correctly read "Implementation";
  CSM exactly matched the original `CustomerDataExport.csv` seed data
  (independent cross-check #2); prod/test URLs correctly empty (not live
  yet — correct absence, not a data gap).

This method also surfaces `RelatedValue.Project-Manager` and
`RelatedValue.Current-Release-on-Prod`/`Current-Release-on-Test` — two
fields the original design explicitly marked "no Link equivalent found."

**Constraint carried over:** this method needs at least one known ticket ID
for the customer as a starting point — there's no way to query fields from
a bare customer name alone.

## Explicit scope decision: no field curation

Rather than picking a fixed set of fields (as the original design did),
this revival captures **everything** `parent_task` returns, unfiltered.
Rationale (per user decision): the field set is rich, varies by customer
lifecycle stage and ticket type, and a fixed schema would need constant
maintenance as Link's field catalog evolves. This trades a clean, curated
UI for completeness.

Two direct consequences:
1. **Storage must be schemaless** (JSONB), not per-field columns — the
   field set isn't uniform across customers (confirmed: Canadian Press,
   Pinterest, and Walmart's `parent_task` objects all had different shapes,
   since they hit different immediate parent record types — Support Case,
   Epic, Platform Deployment respectively).
2. **Display must be generic** (dynamic key/value rows), not a fixed set of
   labeled fields.

## Architecture & data flow

```
[Sync, per customer]
    → GetCustomerRecentWork (existing, 14-day window) — unchanged, for tickets
    → if zero tasks returned: widen to a broader/lifetime search for just
      ONE anchor ticket ID (exact query TBD by an implementation spike —
      see "Open technical risk" below)
    → GetTaskDetail(anchor ticket ID) → read the parent_task object verbatim
    → write-link-data.js's existing optional "fields" key carries this raw
      object (previously unused since Task 1 FAILed; now populated)
    → upsert into a new link_customer_fields table (customer_name, data
      JSONB, synced_at)
[Browser]
    → GET /api/link-data/:customerName returns fields: <raw JSONB> | null
      (stops hardcoding null)
    → Link Data panel's "Link Customer Fields" sub-panel renders every key
      in the JSONB object as a row
```

## Data model & API

New table, alongside the existing `link_customer_tasks`/`link_sync_status`:

```sql
CREATE TABLE IF NOT EXISTS link_customer_fields (
    customer_name TEXT PRIMARY KEY REFERENCES customers(customer_name) ON DELETE CASCADE,
    data          JSONB NOT NULL,
    synced_at     TIMESTAMPTZ NOT NULL
);
```

`scripts/write-link-data.js` gains support for its already-designed-but-unused
optional `fields` key: `{customerName, fields?: {...raw parent_task...}, tasks: [...]}`.
When present, upserts `data = fields` via `ON CONFLICT (customer_name) DO
UPDATE`. Tasks-only syncs (fields omitted) continue to work exactly as
today — purely additive, no breaking change.

`GET /api/link-data/:customerName` stops hardcoding `fields: null`; queries
`link_customer_fields` and returns the raw `data` JSONB (or `null` if never
synced). `syncedAt` continues to come from `link_sync_status`, unchanged.

No change needed to the "Copy Sync Command" button's copied text — it's
already generic enough to cover a sync that now includes fields.

## UI

The "Link Customer Fields" sub-panel returns to the Link Data panel,
positioned above "Recent Link Tickets" (as in the original design). Reuses
the existing `cs-grid`/`cs-field`/`cs-label`/`cs-value` classes, but rows
are generated dynamically from `Object.entries(fields)`:

- **Row label**: the raw Link field name as returned (e.g.
  `InheritedValue.Inherited-SLA-Contract-Type`) — no prettification, since
  a display-name mapping for an open-ended field set would reintroduce the
  curation problem just ruled out.
- **Row value**: cleaned for display —
  - `{Value, RecordID, ...}` objects → show just `.Value`
  - arrays → joined (e.g. with `, `)
  - HTML markup in string values (e.g. `<a href="...">`, `<span style="...">`)
    → tags stripped, plain text shown
  - `null`/`undefined`/`''` → `—`
- **Container**: scrollable (same pattern as the existing customers table's
  scroll wrapper), since 60-100 rows won't fit in the panel otherwise.
- **Never-synced / excluded (`QA-`) states**: same empty-state treatment
  already used for the tickets sub-panel.

## Error handling & edge cases

- **No anchor ticket found even after widening the search** (a customer
  with no ticket history at all — unlikely but possible): fields stay
  un-synced for that run; the `fields` key is simply omitted from that
  customer's sync payload, same mechanism as the existing tasks-only
  fallback. Not a hard failure.
- **`GetTaskDetail` errors on the anchor ticket**: skip fields for that
  customer, continue the batch (same skip-and-continue pattern already used
  for per-customer failures in the tickets sync).
- **Anchor ticket has no `parent_task` in the response** (e.g. it's already
  a root-level record): skip fields for that customer this run rather than
  retrying with a different anchor — keeps the procedure bounded instead of
  open-ended retry logic.
- **Customer deleted from `customers` table**: `ON DELETE CASCADE`, same as
  the existing tables — no orphaned rows.

## Open technical risk (requires an implementation spike)

The "widen search for one anchor ticket" fallback (for customers with zero
tickets in the 14-day window) has **not** been tested live. Before it ships,
an implementation spike must validate: (a) what query reliably finds at
least one ticket for a customer with no recent activity, and (b) that the
found ticket actually belongs to the intended customer — an imprecise
fallback query risks anchoring on the wrong customer's ticket and capturing
wrong fields data. If the spike can't find a sufficiently precise fallback,
this falls back to "skip fields for zero-recent-ticket customers this
round" (same as the "no anchor ticket found" case above) rather than
shipping an unreliable guess.

## Out of scope

- Any curated/fixed field list — deliberately rejected in favor of raw
  completeness (see "Explicit scope decision" above).
- Changing the "Copy Sync Command" button's behavior or copied text.
- Retrying with alternate anchor tickets if the first choice has no
  `parent_task` or turns out to belong to the wrong customer.
- Any change to the existing `link_customer_tasks`/`link_sync_status`
  tables or the tickets half of the sync — this is purely additive.
