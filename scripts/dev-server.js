#!/usr/bin/env node
/**
 * dev-server.js — Local development server with live reload
 *
 * Usage:
 *   node scripts/dev-server.js            # serves src/ on port 3000
 *   node scripts/dev-server.js --port 8080
 *   node scripts/dev-server.js --dir dist # serves dist/ (preview mode)
 */

const http            = require('http');
const https           = require('https');
const fs              = require('fs');
const path            = require('path');
const os              = require('os');
const events          = require('events');
const { spawn }       = require('child_process');

loadEnvFile(path.join(__dirname, '..', '.env'));

const POSTMAN_CLI     = process.env.POSTMAN_CLI || '/opt/homebrew/bin/postman';
const POSTMAN_API_KEY = process.env.POSTMAN_API_KEY;

if (!POSTMAN_API_KEY) {
  console.warn('[postman] POSTMAN_API_KEY not set — copy .env.example to .env and fill it in. Postman sync/run routes will fail.');
}

// Loads KEY=VALUE pairs from a .env file into process.env (existing env vars win).
function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

// Populated on startup from Postman API — { name: uid }
let Postman_Environments = {};
let Postman_Collections  = {};


async function fetchPostmanEnvironments() {
  return new Promise(resolve => {
    const req = https.get(
      'https://api.getpostman.com/environments',
      { headers: { 'X-API-Key': POSTMAN_API_KEY } },
      res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', async () => {
          try {
            const data = JSON.parse(Buffer.concat(chunks).toString());
            const items = data.environments || [];

            // Build name→uid map for the UI dropdown
            Postman_Environments = {};
            items.forEach(e => { Postman_Environments[e.name] = e.uid; });
            log(`Postman environments loaded: ${items.length} entries`);

            // Upsert all environments into the DB
            if (pgPool && items.length) {
              try {
                await pgPool.query(`
                  CREATE TABLE IF NOT EXISTS postman_environments (
                    uid        TEXT        PRIMARY KEY,
                    id         TEXT,
                    name       TEXT        NOT NULL,
                    owner      TEXT,
                    is_public  BOOLEAN,
                    created_at TIMESTAMPTZ,
                    updated_at TIMESTAMPTZ,
                    synced_at  TIMESTAMPTZ DEFAULT NOW()
                  )
                `);

                for (const e of items) {
                  await pgPool.query(`
                    INSERT INTO postman_environments (uid, id, name, owner, is_public, created_at, updated_at, synced_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
                    ON CONFLICT (uid) DO UPDATE SET
                      id         = EXCLUDED.id,
                      name       = EXCLUDED.name,
                      owner      = EXCLUDED.owner,
                      is_public  = EXCLUDED.is_public,
                      updated_at = EXCLUDED.updated_at,
                      synced_at  = NOW()
                  `, [
                    e.uid,
                    e.id        ?? null,
                    e.name,
                    e.owner     ?? null,
                    e.isPublic  ?? null,
                    e.createdAt ? new Date(e.createdAt) : null,
                    e.updatedAt ? new Date(e.updatedAt) : null,
                  ]);
                }
                log(`Postman environments synced to DB: ${items.length} rows upserted`);
              } catch (dbErr) {
                log(`DB sync failed for postman_environments: ${dbErr.message}`);
              }
            }
          } catch (err) {
            log(`Failed to parse Postman environments: ${err.message}`);
          }
          resolve();
        });
      }
    );
    req.on('error', err => {
      log(`Failed to fetch Postman environments: ${err.message}`);
      resolve();
    });
  });
}

async function fetchPostmanCollections() {
  return new Promise(resolve => {
    const req = https.get(
      'https://api.getpostman.com/collections',
      { headers: { 'X-API-Key': POSTMAN_API_KEY } },
      res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', async () => {
          try {
            const data = JSON.parse(Buffer.concat(chunks).toString());
            const items = data.collections || [];

            // Build name→uid map for the UI dropdown
            Postman_Collections = {};
            items.forEach(c => { Postman_Collections[c.name] = c.uid; });
            log(`Postman collections loaded: ${items.length} entries`);

            // Upsert all collections into the DB
            if (pgPool && items.length) {
              try {
                await pgPool.query(`
                  CREATE TABLE IF NOT EXISTS postman_collections (
                    uid        TEXT        PRIMARY KEY,
                    id         TEXT,
                    name       TEXT        NOT NULL,
                    owner      TEXT,
                    is_public  BOOLEAN,
                    fork       JSONB,
                    created_at TIMESTAMPTZ,
                    updated_at TIMESTAMPTZ,
                    synced_at  TIMESTAMPTZ DEFAULT NOW()
                  )
                `);

                for (const c of items) {
                  await pgPool.query(`
                    INSERT INTO postman_collections (uid, id, name, owner, is_public, fork, created_at, updated_at, synced_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
                    ON CONFLICT (uid) DO UPDATE SET
                      id         = EXCLUDED.id,
                      name       = EXCLUDED.name,
                      owner      = EXCLUDED.owner,
                      is_public  = EXCLUDED.is_public,
                      fork       = EXCLUDED.fork,
                      updated_at = EXCLUDED.updated_at,
                      synced_at  = NOW()
                  `, [
                    c.uid,
                    c.id       ?? null,
                    c.name,
                    c.owner    ?? null,
                    c.isPublic ?? null,
                    c.fork     ? JSON.stringify(c.fork) : null,
                    c.createdAt ? new Date(c.createdAt) : null,
                    c.updatedAt ? new Date(c.updatedAt) : null,
                  ]);
                }
                log(`Postman collections synced to DB: ${items.length} rows upserted`);
              } catch (dbErr) {
                log(`DB sync failed for postman_collections: ${dbErr.message}`);
              }
            }
          } catch (err) {
            log(`Failed to parse Postman collections: ${err.message}`);
          }
          resolve();
        });
      }
    );
    req.on('error', err => {
      log(`Failed to fetch Postman collections: ${err.message}`);
      resolve();
    });
  });
}

const args    = process.argv.slice(2);
const PORT    = parseInt(argValue(args, '--port') || '3000');
const SERVE   = argValue(args, '--dir') || 'src';
const ROOT    = path.resolve(__dirname, '..', SERVE);
const RELOAD  = new events.EventEmitter();
const CONFIG  = loadConfig();

// ── Database pool (optional) ─────────────────────────
let pgPool = null;
try {
  const { Pool } = require('pg');
  const db = CONFIG.database;
  if (db) {
    pgPool = new Pool(db);
    pgPool.on('error', err => console.error('[db] pool error:', err.message));
  }
} catch (e) {
  console.warn('[db] pg unavailable — API routes disabled:', e.message);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css' : 'text/css',
  '.js'  : 'text/javascript',
  '.json': 'application/json',
  '.png' : 'image/png',
  '.jpg' : 'image/jpeg',
  '.svg' : 'image/svg+xml',
  '.ico' : 'image/x-icon',
  '.woff2':'font/woff2',
};

// ── API handler ──────────────────────────────────────
const CUSTOMERS_QUERY = `
  SELECT
    unique_id          AS "uniqueId",
    customer_name      AS "customerName",
    launched,
    status,
    release_name       AS "releaseName",
    release,
    last_major_update  AS "lastMajorUpdate",
    last_minor_update  AS "lastMinorUpdate",
    ol_poc             AS "olPoc",
    csm,
    pm,
    implementation,
    expert_services    AS "expertServices",
    partner_contact    AS "partnerContact",
    authorized_regions AS "authorizedRegions",
    access_notes       AS "accessNotes",
    sla_type           AS "slaType",
    weekend_upgrades   AS "weekendUpgrades",
    maintenance_window AS "maintenanceWindow",
    emergency_window   AS "emergencyWindow",
    timezone,
    modules,
    prod_url           AS "prodUrl",
    test_url           AS "testUrl",
    launch_date        AS "launchDate",
    csat_score         AS "csatScore",
    kb_article         AS "kbArticle",
    uat_url            AS "uatUrl",
    int_url            AS "intUrl",
    ppe_url            AS "ppeUrl",
    stage_url          AS "stageUrl"
  FROM customers
  ORDER BY customer_name
`;

const UPDATABLE_FIELDS = {
  customerName:      'customer_name',
  status:            'status',
  launched:          'launched',
  olPoc:             'ol_poc',
  csm:               'csm',
  pm:                'pm',
  implementation:    'implementation',
  releaseName:       'release_name',
  slaType:           'sla_type',
  weekendUpgrades:   'weekend_upgrades',
  maintenanceWindow: 'maintenance_window',
  emergencyWindow:   'emergency_window',
  timezone:          'timezone',
  modules:           'modules',
  prodUrl:           'prod_url',
  testUrl:           'test_url',
  launchDate:        'launch_date',
  csatScore:         'csat_score',
  kbArticle:         'kb_article',
  uatUrl:            'uat_url',
  intUrl:            'int_url',
  ppeUrl:            'ppe_url',
  stageUrl:          'stage_url',
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

function jsonResponse(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type'  : 'application/json',
    'Cache-Control' : 'no-store',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function handleApi(req, res) {
  const url = req.url.split('?')[0];

  // GET /api/postman-environments — DB-backed
  if (url === '/api/postman-environments' && req.method === 'GET') {
    if (!pgPool) return jsonResponse(res, 503, { error: 'Database not configured' });
    const { rows } = await pgPool.query(
      'SELECT name, uid FROM postman_environments ORDER BY name'
    );
    return jsonResponse(res, 200, rows);
  }

  // GET /api/postman-collections — DB-backed
  if (url === '/api/postman-collections' && req.method === 'GET') {
    if (!pgPool) return jsonResponse(res, 503, { error: 'Database not configured' });
    const { rows } = await pgPool.query(
      'SELECT name, uid FROM postman_collections ORDER BY name'
    );
    return jsonResponse(res, 200, rows);
  }

  if (!pgPool) {
    return jsonResponse(res, 503, { error: 'Database not configured' });
  }

  // GET /api/customers
  if (url === '/api/customers' && req.method === 'GET') {
    const { rows } = await pgPool.query(CUSTOMERS_QUERY);
    return jsonResponse(res, 200, rows);
  }

  // POST /api/customers — create new customer
  if (url === '/api/customers' && req.method === 'POST') {
    let data;
    try { data = JSON.parse(await readBody(req)); }
    catch { return jsonResponse(res, 400, { error: 'Invalid JSON body' }); }

    if (!data.customerName?.trim()) {
      return jsonResponse(res, 400, { error: 'customerName is required' });
    }

    const uniqueId = require('crypto').randomUUID();
    const cols = ['unique_id', 'customer_name'];
    const vals = [uniqueId, data.customerName.trim()];

    for (const [key, val] of Object.entries(data)) {
      if (key === 'customerName') continue;
      const col = UPDATABLE_FIELDS[key];
      if (!col) continue;
      cols.push(col);
      vals.push(val === '' ? null : val);
    }

    const placeholders = vals.map((_, i) => `$${i + 1}`);
    try {
      await pgPool.query(
        `INSERT INTO customers (${cols.join(', ')}) VALUES (${placeholders.join(', ')})`,
        vals
      );
      const byId = CUSTOMERS_QUERY.replace('ORDER BY customer_name', 'WHERE unique_id = $1');
      const { rows } = await pgPool.query(byId, [uniqueId]);
      return jsonResponse(res, 201, rows[0]);
    } catch (err) {
      return jsonResponse(res, 500, { error: err.message });
    }
  }

  // GET /api/customers/:id  or  PATCH /api/customers/:id
  const match = url.match(/^\/api\/customers\/(.+)$/);
  const id = match ? decodeURIComponent(match[1]) : null;
  const byId = CUSTOMERS_QUERY.replace('ORDER BY customer_name', 'WHERE unique_id = $1');

  if (match && req.method === 'GET') {
    const { rows } = await pgPool.query(byId, [id]);
    if (!rows.length) return jsonResponse(res, 404, { error: 'Not found' });
    return jsonResponse(res, 200, rows[0]);
  }

  if (match && req.method === 'PATCH') {
    let data;
    try { data = JSON.parse(await readBody(req)); }
    catch { return jsonResponse(res, 400, { error: 'Invalid JSON body' }); }

    const sets = [];
    const vals = [];
    let i = 1;
    for (const [key, val] of Object.entries(data)) {
      const col = UPDATABLE_FIELDS[key];
      if (!col) continue;
      sets.push(`${col} = $${i++}`);
      vals.push(val === '' ? null : val);
    }
    if (!sets.length) return jsonResponse(res, 400, { error: 'No valid fields to update' });
    sets.push(`updated_at = NOW()`);
    vals.push(id);

    const { rowCount } = await pgPool.query(
      `UPDATE customers SET ${sets.join(', ')} WHERE unique_id = $${i}`, vals
    );
    if (!rowCount) return jsonResponse(res, 404, { error: 'Customer not found' });

    const { rows } = await pgPool.query(byId, [id]);
    return jsonResponse(res, 200, rows[0]);
  }

  // GET /api/link-data/:customerName — Link data cache, read-only
  const linkMatch = url.match(/^\/api\/link-data\/(.+)$/);
  if (linkMatch && req.method === 'GET') {
    const customerName = decodeURIComponent(linkMatch[1]);
    const { rows: taskRows } = await pgPool.query(
      `SELECT task_path AS "taskPath", task_type AS "taskType", status,
              total_minutes AS "totalMinutes", teams
       FROM link_customer_tasks WHERE customer_name = $1 ORDER BY total_minutes DESC NULLS LAST`,
      [customerName]
    );
    const { rows: syncRows } = await pgPool.query(
      `SELECT synced_at AS "syncedAt" FROM link_sync_status WHERE customer_name = $1`,
      [customerName]
    );
    return jsonResponse(res, 200, {
      fields: null,
      tasks: taskRows,
      syncedAt: syncRows[0]?.syncedAt ?? null,
    });
  }

  // POST /api/run — execute Postman CLI and return results
  if (url === '/api/run' && req.method === 'POST') {
    let body;
    try { body = JSON.parse(await readBody(req)); }
    catch { return jsonResponse(res, 400, { error: 'Invalid JSON body' }); }

    const { collection, folder, environment, envVars } = body;
    if (!collection) return jsonResponse(res, 400, { error: 'collection is required' });

    // Extract collection UID and API key from any Postman URL format.
    function parseCollection(input) {
      if (!input) return { uid: input, apiKey: '' };
      if (fs.existsSync(input)) return { uid: input, apiKey: '' };  // local file

      // Workspace or API URL containing /collection/{uid}
      const colMatch = input.match(/\/collection\/([^?/\s]+)/);
      if (colMatch) return { uid: colMatch[1] };

      // Bare UID (no slashes or protocol)
      return { uid: input.split('?')[0] };
    }

    const { uid } = parseCollection(collection);
    const tmpFile = path.join(os.tmpdir(), `postman-run-${Date.now()}.json`);

    const cliArgs = [
      'collection', 'run', uid,
      '--postman-api-key', POSTMAN_API_KEY,
      '-r', 'json',
      '--reporter-json-export', tmpFile,
      '--reporter-json-structure', 'newman',
    ];
    if (folder)                cliArgs.push('--folder', folder);
    if (environment)           cliArgs.push('-e', environment);
    if (envVars?.length) {
      envVars.forEach(({ key, value }) => {
        if (key) cliArgs.push('--env-var', `${key}=${value}`);
      });
    }

    const spawnErr = await new Promise(resolve => {
      const child = spawn(POSTMAN_CLI, cliArgs, { env: { ...process.env } });
      let err = null;
      child.on('error', e => { err = e; });
      child.on('close', () => resolve(err));
    });

    if (!fs.existsSync(tmpFile)) {
      return jsonResponse(res, 500, { error: spawnErr?.message || 'Postman CLI produced no output' });
    }

    try {
      const data = JSON.parse(fs.readFileSync(tmpFile, 'utf8'));
      try { fs.unlinkSync(tmpFile); } catch {}
      return jsonResponse(res, 200, data);
    } catch (e) {
      return jsonResponse(res, 500, { error: 'Failed to parse Postman CLI output: ' + e.message });
    }
  }

  // POST /api/probe — server-side HTTP probe (avoids browser CORS restrictions)
  if (url === '/api/probe' && req.method === 'POST') {
    let body;
    try { body = JSON.parse(await readBody(req)); }
    catch { return jsonResponse(res, 400, { error: 'Invalid JSON body' }); }

    const { url: targetUrl } = body;
    if (!targetUrl) return jsonResponse(res, 400, { error: 'url is required' });

    const start = Date.now();
    try {
      const proto = targetUrl.startsWith('https:') ? https : http;
      const result = await new Promise((resolve, reject) => {
        const outReq = proto.get(targetUrl, {
          timeout: 10_000,
          headers: { 'User-Agent': 'QA-Test-Assist/1.0' },
        }, incoming => {
          let data = '';
          incoming.setEncoding('utf8');
          incoming.on('data', chunk => { if (data.length < 32768) data += chunk; });
          incoming.on('end', () => resolve({
            status    : incoming.statusCode,
            statusText: incoming.statusMessage,
            headers   : incoming.headers,
            body      : data,
          }));
        });
        outReq.on('error', reject);
        outReq.on('timeout', () => { outReq.destroy(); reject(new Error('Request timed out after 10s')); });
      });
      return jsonResponse(res, 200, {
        ok          : result.status >= 200 && result.status < 400,
        status      : result.status,
        statusText  : result.statusText,
        responseTime: Date.now() - start,
        headers     : result.headers,
        body        : result.body,
      });
    } catch (err) {
      return jsonResponse(res, 200, {
        ok          : false,
        error       : err.message,
        responseTime: Date.now() - start,
      });
    }
  }

  return jsonResponse(res, 404, { error: 'Unknown API route' });
}

// ── HTTP server ──────────────────────────────────────
const server = http.createServer((req, res) => {

  // Live-reload SSE endpoint
  if (req.url === '/__reload') {
    res.writeHead(200, {
      'Content-Type' : 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection'   : 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    res.write('data: connected\n\n');

    const onReload = () => res.write('data: reload\n\n');
    RELOAD.on('change', onReload);
    req.on('close', () => RELOAD.off('change', onReload));
    return;
  }

  // API routes
  if (req.url.startsWith('/api/')) {
    handleApi(req, res).catch(err => {
      log(`API error: ${err.message}`);
      jsonResponse(res, 500, { error: err.message });
    });
    return;
  }

  let urlPath = req.url.split('?')[0];
  if (urlPath === '/') urlPath = '/index.html';

  const filePath = path.join(ROOT, urlPath);

  // Security: prevent path traversal
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  if (!fs.existsSync(filePath)) {
    // SPA fallback → index.html
    const index = path.join(ROOT, 'index.html');
    if (fs.existsSync(index)) {
      serveFile(index, res, true);
    } else {
      res.writeHead(404); res.end('Not found');
    }
    return;
  }

  serveFile(filePath, res);
});

function serveFile(filePath, res, injectReload = false) {
  const ext  = path.extname(filePath).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';

  try {
    let content = fs.readFileSync(filePath);

    // Inject Postman data + live-reload into HTML responses
    if ((ext === '.html' || injectReload) && mime.includes('text/html')) {
      const snippet = `
<script>
(function(){
  function populateFromApi(endpoint, selectId, mapKey) {
    window[mapKey] = {};
    fetch(endpoint)
      .then(function(r){ return r.json(); })
      .then(function(items){
        items.forEach(function(e){ window[mapKey][e.name] = e.uid; });
        var sel = document.getElementById(selectId);
        if (!sel) return;
        items.forEach(function(e){
          var o = document.createElement('option');
          o.value = e.name; o.textContent = e.name; sel.appendChild(o);
        });
        // Apply customer filter now that options exist
        if (typeof window.__applyPostmanFilter === 'function') window.__applyPostmanFilter();
      });
  }
  populateFromApi('/api/postman-collections',  'r-collection',  '__POSTMAN_COLLECTIONS__');
  populateFromApi('/api/postman-environments', 'r-postman-env', '__POSTMAN_ENVIRONMENTS__');
})();
</script>
<script>
(function(){
  const es = new EventSource('/__reload');
  es.onmessage = e => { if(e.data==='reload') location.reload(); };
  es.onerror   = () => setTimeout(()=>location.reload(), 2000);
})();
</script>`;
      content = Buffer.from(
        content.toString('utf8').replace('</body>', snippet + '</body>')
      );
    }

    res.writeHead(200, {
      'Content-Type'  : mime,
      'Content-Length': content.length,
      'Cache-Control' : 'no-store',
    });
    res.end(content);
  } catch (e) {
    res.writeHead(500); res.end(`Server error: ${e.message}`);
  }
}

// ── File watcher ─────────────────────────────────────
let debounce;
function watchDir(dir) {
  if (!fs.existsSync(dir)) return;
  fs.watch(dir, { recursive: true }, (event, filename) => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      log(`Changed: ${filename} — sending reload signal`);
      RELOAD.emit('change');
    }, 80);
  });
}

watchDir(ROOT);

// Also watch src/ when previewing dist
if (SERVE === 'dist') {
  const srcDir = path.resolve(__dirname, '..', 'src');
  watchDir(srcDir);
}

// ── Start ────────────────────────────────────────────
// Fetch Postman data before listening so index.html is served with options injected
Promise.all([fetchPostmanEnvironments(), fetchPostmanCollections()]).then(() => {
  server.listen(PORT, () => {
    const url = `http://localhost:${PORT}`;
    console.log('\n  \x1b[36m◆ QA Test Assist — Dev Server\x1b[0m\n');
    console.log(`  \x1b[32m➜  Local:   \x1b[1m${url}\x1b[0m`);
    console.log(`  \x1b[2m   Serving: ${ROOT}\x1b[0m`);
    console.log(`  \x1b[2m   Live reload: enabled\x1b[0m\n`);
    console.log('  Press \x1b[1mCtrl+C\x1b[0m to stop\n');

    // Auto-open browser (best effort)
    try {
      const { execSync } = require('child_process');
      const cmd = process.platform === 'win32' ? `start ${url}`
                : process.platform === 'darwin' ? `open ${url}`
                : `xdg-open ${url}`;
      execSync(cmd, { stdio: 'ignore' });
    } catch { /* ignore if fails */ }
  });
});

server.on('error', e => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\x1b[31mERR  Port ${PORT} is in use. Try: --port ${PORT+1}\x1b[0m`);
  } else {
    console.error(`\x1b[31mERR  ${e.message}\x1b[0m`);
  }
  process.exit(1);
});

// ── Helpers ──────────────────────────────────────────
function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'qa-dashboard.config.json'), 'utf8'));
  } catch { return {}; }
}

function argValue(args, flag) {
  const i = args.indexOf(flag);
  return i !== -1 && args[i+1] ? args[i+1] : null;
}

function log(msg) {
  const ts = new Date().toTimeString().slice(0,8);
  console.log(`\x1b[2m[${ts}]\x1b[0m \x1b[36mINFO \x1b[0m ${msg}`);
}
