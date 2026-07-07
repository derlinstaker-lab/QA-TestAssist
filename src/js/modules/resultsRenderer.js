/**
 * resultsRenderer.js — Builds and appends result/assertion rows
 * into the runner results panel.
 *
 * Knows about DOM structure but not about run orchestration.
 */

/**
 * @param {number} status HTTP status code
 * @returns {string} CSS class
 */
function statusClass(status) {
  if (status >= 500) return 'code-5xx';
  if (status >= 400) return 'code-4xx';
  if (status >= 300) return 'code-3xx';
  return 'code-2xx';
}

/**
 * Append one request result row to #result-list.
 * @param {import('../data/mockCollection.js').MockRequest} req
 */
export function appendResultRow(req) {
  const list = document.getElementById('result-list');
  if (!list) return;

  const sc   = statusClass(req.status);
  const mc   = `method-${req.method.toLowerCase()}`;
  const fails = req.assertions.filter(a => a.includes('FAILED'));
  const desc  = req.pass
    ? `✓ ${req.assertions.length} assertion${req.assertions.length !== 1 ? 's' : ''} passed &nbsp;·&nbsp; ${req.ms}ms`
    : `✗ ${fails.length} assertion${fails.length !== 1 ? 's' : ''} failed &nbsp;·&nbsp; ${req.ms}ms`;

  const row = document.createElement('div');
  row.className = 'result-row';
  row.innerHTML = `
    <div>
      <div class="result-name">${req.name}</div>
      <div class="result-desc">${desc}</div>
    </div>
    <span class="http-method ${mc}">${req.method}</span>
    <span class="status-code ${sc}">${req.status}</span>
    <span class="badge ${req.pass ? 'pass' : 'fail'}">${req.pass ? 'PASS' : 'FAIL'}</span>`;

  list.appendChild(row);
}

/**
 * Append assertion rows for one request to #assertion-list.
 * @param {import('../data/mockCollection.js').MockRequest} req
 */
export function appendAssertionRows(req) {
  const list = document.getElementById('assertion-list');
  if (!list) return;

  const sc = statusClass(req.status);
  const mc = `method-${req.method.toLowerCase()}`;

  req.assertions.forEach(assertion => {
    const isFail = assertion.includes('FAILED');
    const row = document.createElement('div');
    row.className = 'result-row';
    row.innerHTML = `
      <div>
        <div class="result-name" style="font-size:0.74rem">${assertion.replace(' — FAILED', '')}</div>
        <div class="result-desc">${req.name}</div>
      </div>
      <span class="http-method ${mc}">${req.method}</span>
      <span class="status-code ${sc}">${req.status}</span>
      <span class="badge ${isFail ? 'fail' : 'pass'}">${isFail ? 'FAIL' : 'PASS'}</span>`;

    list.appendChild(row);
  });
}

/** Update the four live summary counters. */
export function updateSummary({ total, passed, failed, totalMs }) {
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };
  set('s-total', total);
  set('s-pass',  passed);
  set('s-fail',  failed);
  set('s-time',  (totalMs / 1000).toFixed(2) + 's');
}

/** Render raw JSON payload in the Raw Results tab. */
export function setRawResults(data) {
  const el = document.getElementById('raw-results');
  if (!el) return;
  const pre = document.createElement('pre');
  pre.style.cssText = 'margin:0;white-space:pre-wrap;word-break:break-all;font-size:0.75rem;';
  pre.textContent = JSON.stringify(data, null, 2);
  el.replaceChildren(pre);
}

/** Clear results and assertion lists back to empty state. */
export function clearResults() {
  ['result-list', 'assertion-list'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '';
  });
  const raw = document.getElementById('raw-results');
  if (raw) raw.innerHTML = '<span class="log-dim">// Run a collection to see raw output here</span>';
  updateSummary({ total: '—', passed: '—', failed: '—', totalMs: 0 });
  document.getElementById('s-time').textContent = '—';
}
