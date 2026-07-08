# Link Data Panel — "Copy Sync Command" Button Design

**Date:** 2026-07-08
**Status:** Approved by user, pending implementation plan

## Summary

Add a button to the Customers page's "Link Data" panel (`src/index.html`,
rendered by `src/js/modules/linkData.js`) that copies a ready-to-paste
Claude Code prompt for syncing the currently selected customer's Link data.
This is a UI convenience only — it does not perform any sync itself.

## Why not real server-side sync

The original request was a button that actually initiates a Link sync from
the browser. That's not achievable: `dev-server.js` has no way to
authenticate to Link. The only working path to Link in this project is the
`orangelogic-foundation` MCP plugin's interactive, user-delegated SSO
session — the same one a human uses inside a Claude Code session. There is
no service-account / client-credentials / API-key style non-interactive
auth available (confirmed with the user directly: they only have their own
interactive SSO login, no headless credentials). A Node server process
cannot obtain or use that session on its own.

This is the same constraint that led the original Link Data feature
(`docs/superpowers/specs/2026-07-07-link-data-section-design.md`) to choose
a manually-triggered, Claude Code-driven sync (documented in
`docs/link-data-sync-runbook.md`) over live server-side integration. This
button doesn't change that architecture — it just reduces the friction of
using it for one customer at a time.

## Architecture & data flow

Entirely client-side. No new API routes, no new secrets, no server changes.

```
[User clicks "Copy Sync Command" in the Link Data panel]
    → linkData.js reads the currently-tracked selected customer's name
    → builds a one-line prompt string referencing docs/link-data-sync-runbook.md
    → navigator.clipboard.writeText(prompt)
    → button label briefly shows "Copied!" then reverts
    → (on clipboard failure) falls back to window.prompt() with the same text
[User pastes the copied prompt into a Claude Code session themselves]
```

## UI details

- **Placement:** in the Link Data panel's header, next to the existing
  "Last synced" badge (`#link-data-synced`) — reuses the `.cs-btn` style
  already used for the Customers panel's "Refresh" button
  (`#customers-refresh-btn`), for visual consistency.
- **Label:** "Copy Sync Command" (not "Sync") — the button doesn't perform a
  sync, and the label must not imply that it does.
- **States:**
  - No customer selected: button `disabled`.
  - Selected customer's name starts with `QA-` (permanently excluded from
    sync, per the original design): button `disabled` — nothing meaningful
    to copy.
  - Normal customer selected: button enabled. On click, copies the text and
    the label changes to "Copied!" for ~1.5 seconds, then reverts to "Copy
    Sync Command".
  - `navigator.clipboard.writeText()` throws/rejects (blocked permission,
    non-secure context, or the API is unavailable): fall back to
    `window.prompt("Copy this into a Claude Code session:", promptText)` so
    the text is still selectable/copyable manually, rather than failing
    silently.

## Copied text format

One line, referencing the existing runbook rather than duplicating its
procedure:

```
Sync Link data for customer "<customerName>" (single customer only) per docs/link-data-sync-runbook.md.
```

`<customerName>` is the exact `customerName` string already tracked inside
`linkData.js` from the `customer:selected` event — no new data source
needed.

## Out of scope

- Any real, automated, or scheduled Link sync triggered from the browser or
  server.
- Changes to `docs/link-data-sync-runbook.md`'s actual procedure (this
  button only points at it).
- Changes to the batch/all-customers sync flow — this is single-customer
  only, by design (matches the button's placement next to one customer's
  data).
