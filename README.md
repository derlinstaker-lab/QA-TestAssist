# QA Test Assist — Modular

Refactored from a single 975-line HTML file into a clean, modular
multi-file architecture using native ES modules, separated CSS layers,
and a data / module / entry-point split.

---

## Architecture

```
src/
├── index.html              ← Lean HTML shell (no inline styles or scripts)
│
├── css/
│   ├── tokens.css          ← All design tokens (colours, spacing, fonts)
│   ├── base.css            ← Reset, body, animations, shared utilities
│   ├── header.css          ← Sticky navigation bar
│   ├── stats.css           ← KPI stat cards
│   ├── panel.css           ← Panel shell, data table, progress bar
│   ├── activity.css        ← Activity feed
│   └── runner.css          ← Postman runner (form, results, console)
│
└── js/
    ├── main.js             ← Entry point — imports and boots all modules
    │
    ├── data/               ← Pure data (swap for API calls)
    │   ├── stats.js
    │   ├── recentRuns.js
    │   ├── activity.js
    │   └── mockCollection.js
    │
    └── modules/            ← UI modules (one responsibility each)
        ├── clock.js         ← Live header timestamp
        ├── stats.js         ← Renders KPI cards from data/stats.js
        ├── recentRuns.js    ← Renders runs table + progress bar
        ├── activity.js      ← Renders activity feed
        ├── headerSync.js    ← Keeps Env/Suite dropdowns in sync
        ├── tabs.js          ← Generic tab-panel switching
        ├── console.js       ← Runner log output (append/clear/scroll)
        ├── commandBuilder.js← Builds & copies the CLI command preview
        ├── resultsRenderer.js← Renders result + assertion rows
        └── runner.js        ← Run orchestrator (wires all sub-modules)
```

### Module responsibilities

| Module | What it owns |
|--------|-------------|
| `clock.js` | Header timestamp tick loop |
| `stats.js` | Stat card HTML generation |
| `recentRuns.js` | Table rows + progress bar |
| `activity.js` | Activity item HTML generation |
| `headerSync.js` | Bidirectional dropdown sync |
| `tabs.js` | Generic tab activation (no runner knowledge) |
| `console.js` | Log append/clear — no run knowledge |
| `commandBuilder.js` | CLI command string — no run knowledge |
| `resultsRenderer.js` | DOM row creation — no run knowledge |
| `runner.js` | Run state machine — imports and coordinates the above |

### Data layer

All application data lives in `src/js/data/`. Each file exports typed
constants. To switch from mock data to a live API, replace the export
in the relevant data file — no module code changes required.

---

## Quick Start

```bash
npm install
npm run dev       # → http://localhost:3000  (ES modules served natively)
npm run build     # → dist/index.html        (single-file, fully inlined & minified)
```

### How the build works

The build script (`scripts/build.js`) produces a **single self-contained
`dist/index.html`** from the multi-file source:

1. Reads `src/index.html`
2. Inlines all `<link rel="stylesheet">` CSS files into `<style>` blocks
3. Walks the ES module import graph starting from `src/js/main.js` and
   concatenates all modules into one `<script>` block, stripping
   `import`/`export` statements
4. Minifies CSS (clean-css), JS (terser), and HTML (html-minifier-terser)
5. Injects build metadata (version, timestamp, git hash, env)
6. Writes `dist/index.html` + `dist/build-manifest.json`

No bundler (webpack/vite/rollup) required — the build is ~150 lines of
plain Node.js.

---

## Development

During development the browser loads ES modules natively. The dev server
(`scripts/dev-server.js`) injects a live-reload SSE snippet so the browser
refreshes automatically when any `src/` file changes.

```bash
npm run build:watch   # rebuild dist/ on every save
npm run preview       # serve dist/ to verify the production build
```

---

## Deployment

Same targets as before — see the original project README or run:

```bash
npm run deploy:s3        # AWS S3 + optional CloudFront invalidation
npm run deploy:gh-pages  # push dist/ to gh-pages branch
npm run deploy:netlify   # Netlify CLI deploy
```

The GitHub Actions workflow (`.github/workflows/ci-cd.yml`) auto-deploys
on every push to `main`.
