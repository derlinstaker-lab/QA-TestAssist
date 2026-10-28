import { initClock }              from './modules/clock.js';
import { initEnvironmentSelects } from './modules/environmentSelects.js';
import { initClientSelects, getSelectedCustomer } from './modules/customerSelect.js';

// Same mapping/derivation as the Useful URLs card in test_assist.js.
const ENV_URL_PROP = {
  TEST:  'testUrl',
  UAT:   'uatUrl',
  PROD:  'prodUrl',
  INT:   'intUrl',
  PPE:   'ppeUrl',
  STAGE: 'stageUrl',
};

const COMMIT_TIMEOUT_MS = 60000; // give up waiting for a tab's site to respond
const SETTLE_MS         = 4000;  // extra time after it responds, for the page to finish loading
const POLL_MS           = 250;

function getBaseUrl() {
  const customer = getSelectedCustomer();
  const env      = document.getElementById('env-select')?.value;
  const raw      = customer?.[ENV_URL_PROP[env]];
  const first    = raw?.split(',').map(u => u.trim()).find(Boolean);
  return first ? first.replace(/\/olsso\/?$/i, '').replace(/\/+$/, '') : null;
}

function getRegressionTabs(baseUrl) {
  return [
    { label: 'BaseURL',      url: baseUrl },
    { label: 'OLSSO',        url: baseUrl + '/OLSSO' },
    { label: 'RunChecks',    url: baseUrl + '/API/Monitoring/v1.0/RunChecks' },
    { label: 'Profile Diff', url: baseUrl + '/CS.aspx?VP3=ParamDiff&Profile=COR&Module=ActivatedModules_BO' },
  ];
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * The opener can't see load events on a cross-origin tab. It can tell when the
 * tab's site has responded, though: the initial about:blank is same-origin and
 * readable, and reading it throws once the customer's document replaces it.
 */
async function waitForTab(win) {
  const deadline = Date.now() + COMMIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (win.closed) throw new Error('tab was closed');
    try {
      const href = win.location.href;
      if (href !== 'about:blank' && win.document.readyState === 'complete') break;
    } catch {
      break; // cross-origin document has committed
    }
    await sleep(POLL_MS);
  }
  await sleep(SETTLE_MS);
}

function renderRegressionUrls() {
  const container = document.getElementById('regression-urls');
  if (!container) return;
  const baseUrl = getBaseUrl();
  const labels  = getRegressionTabs('').map(tab => tab.label);
  const urls    = baseUrl ? getRegressionTabs(baseUrl).map(tab => tab.url) : [];

  container.innerHTML = '';
  labels.forEach((label, i) => {
    const hint = document.createElement('p');
    hint.className = 'util-card-hint';
    hint.textContent = `${i + 1}. ${label}`;

    const link = document.createElement('a');
    link.className = 'util-output' + (urls[i] ? '' : ' is-empty');
    link.textContent = urls[i] || '—';
    link.href = urls[i] || '#';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';

    const row = document.createElement('div');
    row.className = 'util-output-row';
    row.appendChild(link);
    container.append(hint, row);
  });
}

function initRegression() {
  const btn    = document.getElementById('begin-regression-btn');
  const status = document.getElementById('regression-status');
  if (!btn || !status) return;

  document.addEventListener('customer:selected', renderRegressionUrls);
  document.getElementById('env-select')?.addEventListener('change', renderRegressionUrls);
  renderRegressionUrls();

  function setStatus(text) {
    status.textContent = text;
    status.hidden = !text;
  }

  btn.addEventListener('click', async () => {
    const baseUrl = getBaseUrl();
    if (!baseUrl) {
      setStatus('No URL for this customer/env');
      return;
    }

    const tabs = getRegressionTabs(baseUrl);
    btn.disabled = true;
    try {
      for (const [i, tab] of tabs.entries()) {
        setStatus(`Opening ${tab.label} (${i + 1}/${tabs.length})`);
        // No 'noopener': we need the handle to watch the tab load.
        const win = window.open(tab.url, '_blank');
        if (!win) {
          setStatus(`Pop-up blocked at ${tab.label} — allow pop-ups for this site`);
          return;
        }
        await waitForTab(win);
      }
      setStatus(`Opened ${tabs.length}/${tabs.length}`);
    } catch (err) {
      setStatus(`Stopped: ${err.message}`);
    } finally {
      btn.disabled = false;
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initEnvironmentSelects();
  initClientSelects();
  initClock();
  initRegression();
});
