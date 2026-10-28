# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

QA Test Assist — an internal QA tooling dashboard for running/inspecting Postman collections against customer environments and tracking customer metadata. Vanilla JS (native ES modules), no framework, no bundler for dev. A tiny custom Node HTTP server backs it with a Postgres-persisted API. There is no client-side router or SPA framework — it's four separate HTML pages, each with its own JS entry module.

## Commands

```bash
npm run dev              # kill whatever holds the port, then start scripts/dev-server.js on :3000
npm run build            # scripts/build.js → dist/index.html, then restarts the dev server (skipped when CI is set)
npm run build:watch      # rebuild dist/ on every save under src/
npm run preview          # serve dist/ (production build) to sanity-check before deploy
npm run lint             # scripts/lint.js — custom structural linter (see below)
npm run clean            # rm -rf dist/

npm run deploy:s3        # scripts/deploy.js --target s3
npm run deploy:gh-pages  # scripts/deploy.js --target gh-pages
npm run deploy:netlify   # scripts/deploy.js --target netlify
```

There is no test runner/framework configured (no jest/mocha, no `test` script). `npm run lint` only checks `src/index.html` (structure, tag balance, size, stray `console.log`/TODOs) — it is not a JS linter and does not touch the other three HTML pages or any `.js` file directly.

Useful direct commands when developing against the local DB/server (see `.claude/settings.local.json` / `.claude/settings.json` for the exact allowed forms):

```bash
node scripts/dev-server.js --port 3000     # run server directly (no port-kill step)
node scripts/restart-server.js             # equivalent to `npm run dev`
lsof -ti:3000 | xargs kill -9              # free the port manually if restart-server.js's kill fails
psql -d qa_dashboard -f src/db/schema.sql  # (re-)apply schema — idempotent, safe to re-run
psql -d qa_dashboard -f src/db/seed.sql
curl -s http://localhost:3000/api/customers
```

## Architecture

### Four pages, one module system, two different JS layouts

`src/*.html` — `index.html` (dashboard), `test_assist.html`, `postman_tests.html`, `test_results.html`. Each links a subset of `src/css/*.css` and loads exactly one `<script type="module">` entry point from `src/js/`.

- `index.html` → `js/main.js`, which composes small single-responsibility modules from `src/js/modules/` (clock, stats, recentRuns, activity, headerSync, environmentSelects, customerSelect). This is the only page decomposed into `modules/`.
- The other three pages (`test_assist.js`, `postman_tests.js`, `test_results.js`) are flat, self-contained entry scripts living directly in `src/js/` — they are not split into `modules/`. Don't assume logic for those pages lives under `modules/`; check the flat file first.

`src/js/data/` holds data-shape modules (`stats.js`, `recentRuns.js`, `activity.js`, `environments.js`, `mockCollection.js`, `customers.js`). Per the original design intent, swapping mock data for a live API call means editing the export inside the relevant `data/` file, not the consuming module — though `customers.js` and `environmentSelects.js` already call the real `/api/*` endpoints, so much of the data layer is live, not mock.

### Build pipeline only covers `index.html`

`scripts/build.js` is a from-scratch ~150-line bundler (no webpack/vite/rollup): it inlines `<link rel="stylesheet">` CSS, recursively resolves the ES `import` graph starting from `src/index.html`'s module script (stripping `import`/`export` statements), then minifies via clean-css/terser/html-minifier-terser and writes a single `dist/index.html` plus `dist/build-manifest.json`.

**Important**: it only reads and bundles `src/index.html`. `test_assist.html`, `postman_tests.html`, and `test_results.html` are not processed by `npm run build` at all — there is currently no bundled/minified/deployed output for those three pages. Keep this in mind when changing the build or deploy scripts, or when those pages are expected in production.

### Dev server (`scripts/dev-server.js`)

Plain `http.createServer`, no Express/Fastify. Responsibilities:
- Static file serving of `src/` (or `--dir dist` in preview mode), with MIME map for html/css/js/json/images/fonts.
- Live reload via SSE at `/__reload` (a `chokidar`-driven `EventEmitter` broadcasts `reload` on any `src/` file change; the injected client snippet reconnects the page).
- JSON API under `/api/*` (see below).
- On startup, fetches Postman environments/collections from the Postman API and upserts them into Postgres (`postman_environments`, `postman_collections` tables) as a cache — the in-memory `Postman_Environments`/`Postman_Collections` maps are populated from that same fetch.

`scripts/restart-server.js` frees the configured port (`lsof -ti:<port> | xargs kill`, or `netstat`/`taskkill` on Windows) before spawning `dev-server.js` — necessary because the server holds in-memory Postman cache state and a live DB pool, so a plain file save isn't enough to pick up server-side changes.

### API surface (all in `dev-server.js`, no separate router file)

- `GET /api/postman-environments`, `GET /api/postman-collections` — DB-backed reads of the synced Postman cache.
- `GET /api/customers`, `POST /api/customers`, `GET/PATCH /api/customers/:id` — customer CRUD against Postgres. `UPDATABLE_FIELDS` in `dev-server.js` is the whitelist mapping camelCase request keys to snake_case columns; add new customer fields there **and** in `CUSTOMERS_QUERY` (and the DB schema) together.
- `GET /api/link-data/:customerName` — reads the Postgres cache of a customer's Link data. `POST /api/link-data/:customerName/sync` starts a background headless `claude -p` run (prompt in `scripts/link-sync-prompt.md`, read-only Link tools only, capped by `LINK_SYNC_MAX_USD`) that writes through `scripts/write-link-data.js`; `GET …/sync` polls it. Jobs live in memory, so a server restart drops them. A run takes ~5–15 min and costs a few dollars.
- `POST /api/run` — shells out to the local Postman CLI binary (hardcoded path `/opt/homebrew/bin/postman`) to run a collection/folder/environment and returns the Newman-JSON report.
- `POST /api/probe` — server-side HTTP GET proxy so the browser can hit arbitrary customer URLs without hitting CORS.

All routes 503 if the Postgres pool didn't initialize (`pgPool` is `null` when `pg` fails to load or `qa-dashboard.config.json`'s `database` block is missing).

⚠️ `scripts/dev-server.js` currently has the Postman CLI path and a live Postman API key hardcoded as constants at the top of the file rather than sourced from `.env`/config. Treat this as existing tech debt, not a pattern to extend — new secrets should go through `.env` (see `.env.example`) and `qa-dashboard.config.json`, not literals in source.

### Database

`src/db/schema.sql` is idempotent DDL (safe to re-run) for `customers`, `postman_collections`, `postman_environments`. `src/db/seed.sql` seeds sample rows. Connection config comes from the `database` block in `qa-dashboard.config.json` (host/port/database/user — no password there; expected to come from local Postgres trust auth or `PGPASSWORD`/`~/.pgpass`).

### Config and env

`qa-dashboard.config.json` is the single source of truth for build flags (`minifyHTML`/`minifyCSS`/`minifyJS`), dev server port/live-reload, DB connection, and per-target deploy settings (S3 bucket/CloudFront, gh-pages branch, Netlify site). `.env` (gitignored, copy from `.env.example`) supplies deploy credentials (`AWS_*`, `NETLIFY_*`) consumed by `scripts/deploy.js`.

### CI/CD

`.github/workflows/ci-cd.yml`: `lint` → `build` → conditional deploy job. All three targets (`gh-pages`, `s3`, `netlify`) are `workflow_dispatch`-only, picked via the `deploy_target` input — pushes and PRs only lint and build. The build artifact uploaded/downloaded between jobs is the `dist/` directory produced by `npm run build` — i.e. only the bundled `index.html`, not the other pages. The gh-pages path in `scripts/deploy.js` is currently broken (it pushes a branch that only exists in the temporary `dist/` repo, and to the local repo rather than the remote).
