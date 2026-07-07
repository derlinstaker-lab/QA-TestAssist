/**
 * runner.js — Postman Collection Runner orchestrator.
 *
 * POSTs run config to /api/run, which executes Newman server-side,
 * then renders the real results via resultsRenderer.
 */

import { initCommandBuilder, updateCommandPreview } from './commandBuilder.js';
import { initTabs }                                  from './tabs.js';
import { initConsole, log, clear as clearLog }       from './console.js';
import { getSelectedCustomer }                       from './customerSelect.js';
import {
  appendResultRow,
  appendAssertionRows,
  updateSummary,
  clearResults,
  setRawResults,
} from './resultsRenderer.js';

let isRunning = false;

function readRunConfig() {
  const $ = id => document.getElementById(id);
  const envVars = ($('r-envvars')?.value || '')
    .trim().split('\n')
    .map(line => {
      const eq = line.indexOf('=');
      if (eq < 1) return null;
      return { key: line.slice(0, eq).trim(), value: line.slice(eq + 1).trim() };
    })
    .filter(Boolean);

  const colName  = $('r-collection')?.value.trim()  || '';
  const envName  = $('r-postman-env')?.value.trim() || '';
  const collectionId = window.__POSTMAN_COLLECTIONS__?.[colName]  || colName;
  const environmentId = window.__POSTMAN_ENVIRONMENTS__?.[envName] || envName;

  return {
    col        : collectionId,
    folder     : $('r-folder')?.value.trim() || '',
    postmanEnv : environmentId,
    envVars,
  };
}

function setRunning(on) {
  const btn  = document.getElementById('run-btn');
  const icon = document.getElementById('run-icon');
  if (!btn || !icon) return;
  btn.disabled   = on;
  icon.outerHTML = on
    ? '<span class="spinner" id="run-icon"></span>'
    : '<span id="run-icon">▶</span>';
}

// ── Result rendering ────────────────────────────────────

function processNewmanResults(data) {
  const executions = data.run?.executions ?? [];
  let passed = 0, failed = 0, totalMs = 0;

  if (!executions.length) {
    log('warn', '  No requests were executed.');
    updateSummary({ total: 0, passed: 0, failed: 0, totalMs: 0 });
    return;
  }

  executions.forEach(exec => {
    const name   = exec.item?.name                ?? '(unknown)';
    const method = exec.request?.method           ?? 'GET';
    const status = exec.response?.code            ?? 0;
    const ms     = exec.response?.responseTime    ?? 0;

    const assertions = (exec.assertions ?? []).map(a =>
      a.error ? `${a.assertion} — FAILED` : a.assertion
    );
    const pass = !(exec.assertions ?? []).some(a => a.error);

    totalMs += ms;
    if (pass) passed++; else failed++;

    appendResultRow({ name, method, status, ms, pass, assertions });
    appendAssertionRows({ name, method, status, ms, pass, assertions });

    if (pass) {
      log('success', `  ✓  [${status}]  ${name}  (${ms}ms)`);
    } else {
      log('error', `  ✗  [${status}]  ${name}  (${ms}ms)`);
      assertions
        .filter(a => a.includes('FAILED'))
        .forEach(a => log('warn', `       ↳ ${a}`));
    }
  });

  updateSummary({ total: executions.length, passed, failed, totalMs });

  log('dim', '─'.repeat(52));
  if (failed === 0) {
    log('success', `✔  Run complete — all ${passed} requests passed`);
  } else {
    log('warn', `⚠  Run complete — ${passed} passed, ${failed} failed`);
  }
  log('dim', `   Total duration: ${(totalMs / 1000).toFixed(2)}s`);
}

// ── Run lifecycle ───────────────────────────────────────

async function startRun() {
  if (isRunning) return;

  const config = readRunConfig();
  if (!config.col) {
    log('error', '✗  Please select a Collection before running.');
    return;
  }

  isRunning = true;
  setRunning(true);
  clearResults();
  clearLog();
  updateCommandPreview();

  log('info', '▶  Collection run started');
  log('info', `   Collection : ${config.col}`);
  log('info', `   Env : ${document.getElementById('r-env')?.value || '(none)'}  |  Customer : ${document.getElementById('r-customer')?.value || '(none)'}`);
  log('dim', '─'.repeat(52));

  try {
    const resp = await fetch('/api/run', {
      method  : 'POST',
      headers : { 'Content-Type': 'application/json' },
      body    : JSON.stringify({
        collection  : config.col,
        folder      : config.folder,
        environment : config.postmanEnv,
        envVars     : config.envVars,
      }),
    });

    const payload = await resp.json();

    if (!resp.ok) {
      throw new Error(payload.error || resp.statusText);
    }

    setRawResults(payload);
    processNewmanResults(payload);

  } catch (err) {
    log('error', `✗  Run failed: ${err.message}`);
    updateSummary({ total: '—', passed: '—', failed: '—', totalMs: 0 });
    document.getElementById('s-time').textContent = '—';
  } finally {
    isRunning = false;
    setRunning(false);
  }
}

// ── Postman dropdown filter ─────────────────────────────

function filterPostmanDropdowns() {
  const customer = getSelectedCustomer();
  const term = (customer?.customerName || '').toLowerCase();

  ['r-collection', 'r-postman-env'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    Array.from(sel.options).forEach(opt => {
      if (!opt.value) return; // keep placeholder
      const name = opt.textContent.toLowerCase();
      opt.hidden = !!term && !name.includes(term) && !name.includes('qa');
    });
    // If the currently selected option is now hidden, reset to placeholder
    if (sel.selectedOptions[0]?.hidden) sel.value = '';
  });

  if (term) {
    // Auto-select collection that contains the customer name
    const colSel = document.getElementById('r-collection');
    if (colSel && !colSel.value) {
      const match = Array.from(colSel.options).find(
        o => o.value && !o.hidden && o.textContent.toLowerCase().includes(term)
      );
      if (match) colSel.value = match.value;
    }

    // Auto-select environment that contains the customer name AND the selected env (TEST/UAT/PROD)
    const envSel = document.getElementById('r-postman-env');
    const envValue = (document.getElementById('r-env')?.value || '').toLowerCase();
    if (envSel && !envSel.value) {
      const match = Array.from(envSel.options).find(
        o => o.value && !o.hidden &&
             o.textContent.toLowerCase().includes(term) &&
             o.textContent.toLowerCase().includes(envValue)
      );
      if (match) envSel.value = match.value;
    }
  }

  updateCommandPreview();
}

// ── Auto-match Postman env on environment change ────────

function autoMatchPostmanEnvToEnvironment() {
  const customer = getSelectedCustomer();
  const customerTerm = (customer?.customerName || '').toLowerCase();
  const envValue = (document.getElementById('r-env')?.value || '').toLowerCase();
  if (!customerTerm || !envValue) return;

  const envSel = document.getElementById('r-postman-env');
  if (!envSel) return;

  const match = Array.from(envSel.options).find(
    o => o.value &&
         o.textContent.toLowerCase().includes(customerTerm) &&
         o.textContent.toLowerCase().includes(envValue)
  );
  if (match) envSel.value = match.value;
}

// ── Host var sync ───────────────────────────────────────

function syncHostVar() {
  const textarea = document.getElementById('r-envvars');
  if (!textarea) return;

  const env      = document.getElementById('r-env')?.value;
  const customer = getSelectedCustomer();

  const urlMap = {
    TEST:  customer?.testUrl,
    UAT:   customer?.uatUrl,
    PROD:  customer?.prodUrl,
    INT:   customer?.intUrl,
    PPE:   customer?.ppeUrl,
    STAGE: customer?.stageUrl,
  };
  const baseUrl = urlMap[env] ? urlMap[env].split(',')[0].trim() : null;

  const lines = textarea.value.split('\n').filter(l => !l.trimStart().startsWith('baseURL='));
  if (baseUrl) lines.unshift(`baseURL=${baseUrl}`);
  textarea.value = lines.join('\n').trimEnd();
  updateCommandPreview();
}

// ── Init ────────────────────────────────────────────────

export function initRunner() {
  initCommandBuilder();
  initConsole();
  initTabs(document.getElementById('results-panel'));

  document.getElementById('r-postman-env')?.addEventListener('change', updateCommandPreview);
  document.getElementById('run-btn')?.addEventListener('click', startRun);
  document.getElementById('r-env')?.addEventListener('change', () => { syncHostVar(); autoMatchPostmanEnvToEnvironment(); filterPostmanDropdowns(); });
  document.addEventListener('customer:selected', () => { syncHostVar(); filterPostmanDropdowns(); });

  // Expose so the async populateFromApi fetch can re-apply the filter once options load
  window.__applyPostmanFilter = filterPostmanDropdowns;

  syncHostVar();
  filterPostmanDropdowns();
}
