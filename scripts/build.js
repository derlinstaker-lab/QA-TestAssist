#!/usr/bin/env node
/**
 * build.js — QA Test Assist modular build pipeline
 *
 * Steps:
 *   1. Inline all linked <link rel="stylesheet"> CSS files into one <style> block
 *   2. Bundle all ES module <script type="module"> files (resolves imports recursively)
 *   3. Minify the bundled CSS (clean-css)
 *   4. Minify the bundled JS (terser)
 *   5. Minify the final HTML (html-minifier-terser)
 *   6. Inject build metadata
 *   7. Write dist/index.html + dist/build-manifest.json
 *
 * Usage:
 *   node scripts/build.js             # single build
 *   node scripts/build.js --watch     # watch src/ for changes
 *   node scripts/build.js --env prod  # set target env label
 */

const fs   = require('fs');
const path = require('path');

const ROOT    = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'src');
const SRC     = path.join(SRC_DIR, 'index.html');
const DIST    = path.join(ROOT, 'dist');
const OUT     = path.join(DIST, 'index.html');
const CONFIG  = loadConfig();

const args  = process.argv.slice(2);
const WATCH = args.includes('--watch');
const ENV   = argValue(args, '--env') || CONFIG.defaultEnv || 'production';

// ─────────────────────────────────────────────────
async function build() {
  const t0 = Date.now();
  log('info', `Building QA Test Assist v${CONFIG.version || '?'}  [env=${ENV}]`);

  if (!fs.existsSync(SRC)) { log('error', `Source not found: ${SRC}`); process.exit(1); }

  let html = fs.readFileSync(SRC, 'utf8');
  const srcSize = Buffer.byteLength(html);

  // ── 1. Inline CSS ──────────────────────────────
  html = inlineCSS(html, SRC_DIR);
  log('ok', 'CSS inlined');

  // ── 2. Bundle JS modules ───────────────────────
  html = await bundleJS(html, SRC_DIR);
  log('ok', 'JS modules bundled');

  // ── 3. Minify CSS ──────────────────────────────
  if (CONFIG.build?.minifyCSS !== false) {
    try {
      const CleanCSS = require('clean-css');
      html = html.replace(/<style>([\s\S]*?)<\/style>/gi, (_, css) => {
        const r = new CleanCSS({ level: 2 }).minify(css);
        return `<style>${r.styles}</style>`;
      });
      log('ok', 'CSS minified');
    } catch (e) { log('warn', `CSS minify skipped: ${e.message} — run npm install`); }
  }

  // ── 4. Minify JS ───────────────────────────────
  if (CONFIG.build?.minifyJS !== false) {
    try {
      const { minify } = require('terser');
      const re = /<script>([\s\S]*?)<\/script>/gi;
      const hits = [];
      let m;
      while ((m = re.exec(html)) !== null) hits.push({ ...m, index: m.index, full: m[0], code: m[1] });

      for (const hit of hits.reverse()) {
        const r = await minify(hit.code, { compress: true, mangle: true });
        if (r.code) html = html.slice(0, hit.index) + `<script>${r.code}</script>` + html.slice(hit.index + hit.full.length);
      }
      log('ok', 'JS minified');
    } catch (e) { log('warn', `JS minify skipped: ${e.message} — run npm install`); }
  }

  // ── 5. Inject build meta ───────────────────────
  const meta = {
    version  : CONFIG.version || '2.0.0',
    buildTime: new Date().toISOString(),
    env      : ENV,
    commit   : gitHash(),
  };
  html = html.replace('</head>',
    `<meta name="build-version" content="${meta.version}">
  <meta name="build-time" content="${meta.buildTime}">
  <meta name="build-env" content="${meta.env}">
</head>`);

  // ── 6. Minify HTML ─────────────────────────────
  if (CONFIG.build?.minifyHTML !== false) {
    try {
      const { minify: mH } = require('html-minifier-terser');
      html = await mH(html, {
        collapseWhitespace: true, removeComments: true,
        removeRedundantAttributes: true, useShortDoctype: true,
        minifyCSS: false, minifyJS: false,
      });
      log('ok', 'HTML minified');
    } catch (e) { log('warn', `HTML minify skipped: ${e.message} — run npm install`); }
  }

  // ── 7. Write output ────────────────────────────
  fs.mkdirSync(DIST, { recursive: true });
  fs.writeFileSync(OUT, html, 'utf8');

  // ── 8. Copy static assets ─────────────────────
  const srcData = path.join(SRC_DIR, 'data');
  const distData = path.join(DIST, 'data');
  if (fs.existsSync(srcData)) {
    fs.mkdirSync(distData, { recursive: true });
    fs.readdirSync(srcData).forEach(f => {
      fs.copyFileSync(path.join(srcData, f), path.join(distData, f));
    });
    log('ok', 'Static assets copied (data/)');
  }

  const outSize = Buffer.byteLength(html);
  const savings = (((srcSize - outSize) / srcSize) * 100).toFixed(1);
  const elapsed = Date.now() - t0;

  fs.writeFileSync(path.join(DIST, 'build-manifest.json'), JSON.stringify({
    ...meta,
    files: { 'index.html': { srcBytes: srcSize, distBytes: outSize, savings: `${savings}%` } },
    elapsedMs: elapsed,
  }, null, 2));

  log('success', `→ dist/index.html  (${fmt(srcSize)} → ${fmt(outSize)}, saved ${savings}%, ${elapsed}ms)`);
}

// ─────────────────────────────────────────────────
// CSS inlining
// ─────────────────────────────────────────────────
function inlineCSS(html, baseDir) {
  return html.replace(/<link\s[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*\/?>/gi, (match, href) => {
    if (href.startsWith('http')) return match; // keep external CDN links
    const file = path.join(baseDir, href);
    if (!fs.existsSync(file)) { log('warn', `CSS not found: ${file}`); return ''; }
    return `<style>${fs.readFileSync(file, 'utf8')}</style>`;
  });
}

// ─────────────────────────────────────────────────
// JS module bundling (simple recursive import resolver)
// ─────────────────────────────────────────────────
async function bundleJS(html, baseDir) {
  return html.replace(/<script\s+type=["']module["']\s+src=["']([^"']+)["'][^>]*><\/script>/gi, (match, src) => {
    const entryFile = path.join(baseDir, src);
    if (!fs.existsSync(entryFile)) { log('warn', `JS entry not found: ${entryFile}`); return ''; }
    const bundle = resolveModule(entryFile, new Set());
    return `<script>${bundle}</script>`;
  });
}

/**
 * Recursively resolve ES module imports into a single concatenated string.
 * Strips `import`/`export` statements and replaces with inlined code.
 */
function resolveModule(filePath, visited) {
  if (visited.has(filePath)) return '';
  visited.add(filePath);

  let code = fs.readFileSync(filePath, 'utf8');
  const dir = path.dirname(filePath);

  // Resolve static imports first (depth-first)
  const importRe = /^import\s+(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)?\s*(?:,\s*(?:\{[^}]*\}|\*\s+as\s+\w+))?\s*from\s+['"]([^'"]+)['"]\s*;?/gm;
  let depCode = '';
  let m;
  while ((m = importRe.exec(code)) !== null) {
    const importPath = m[1];
    if (importPath.startsWith('.')) {
      const depFile = path.resolve(dir, importPath.endsWith('.js') ? importPath : importPath + '.js');
      depCode += resolveModule(depFile, visited) + '\n';
    }
  }

  // Strip import statements
  code = code.replace(/^import\s+.*?from\s+['"][^'"]+['"]\s*;?\n?/gm, '');
  // Strip export keywords (keep the declarations)
  code = code.replace(/^export\s+(default\s+)?/gm, '');

  return depCode + code;
}

// ─────────────────────────────────────────────────
// Watch mode
// ─────────────────────────────────────────────────
async function startWatch() {
  await build();
  log('info', `Watching src/ for changes...`);
  let debounce;
  try {
    const chokidar = require('chokidar');
    chokidar.watch(SRC_DIR, { ignoreInitial: true }).on('all', (_, p) => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        log('info', `Changed: ${path.relative(ROOT, p)} → rebuilding...`);
        build().catch(e => log('error', e.message));
      }, 120);
    });
  } catch {
    log('warn', 'chokidar not installed — using fs.watchFile');
    fs.watch(SRC_DIR, { recursive: true }, () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => build().catch(e => log('error', e.message)), 200);
    });
  }
}

// ─────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────
function loadConfig() {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'qa-dashboard.config.json'), 'utf8')); }
  catch { return {}; }
}

function gitHash() {
  try { return require('child_process').execSync('git rev-parse --short HEAD 2>/dev/null', { stdio: ['ignore','pipe','ignore'] }).toString().trim(); }
  catch { return 'unknown'; }
}

function fmt(b) {
  return b < 1024 ? `${b}B` : b < 1048576 ? `${(b/1024).toFixed(1)}KB` : `${(b/1048576).toFixed(2)}MB`;
}

function argValue(a, f) { const i = a.indexOf(f); return i !== -1 && a[i+1] ? a[i+1] : null; }

function log(level, msg) {
  const prefix = { info:'\x1b[36mINFO \x1b[0m', ok:'\x1b[32m  OK \x1b[0m', success:'\x1b[32m✔    \x1b[0m', warn:'\x1b[33mWARN \x1b[0m', error:'\x1b[31mERR  \x1b[0m' }[level] || '     ';
  console.log(`\x1b[2m[${new Date().toTimeString().slice(0,8)}]\x1b[0m ${prefix} ${msg}`);
}

// ─────────────────────────────────────────────────
(async () => {
  try {
    WATCH ? await startWatch() : await build();
  } catch (e) { log('error', e.message); process.exit(1); }
})();
