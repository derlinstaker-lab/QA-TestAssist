import { initClock }              from './modules/clock.js';
import { initHeaderSync }         from './modules/headerSync.js';
import { initEnvironmentSelects } from './modules/environmentSelects.js';
import { initClientSelects, getSelectedCustomer } from './modules/customerSelect.js';

function initCollapsibles() {
  document.querySelectorAll('.section-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const section = btn.closest('.section-collapse');
      const expanded = btn.getAttribute('aria-expanded') === 'true';
      section.classList.toggle('is-collapsed', expanded);
      btn.setAttribute('aria-expanded', String(!expanded));
    });
  });
}

const SPECIAL_CHAR_PRESETS = {
  common:     `! @ # $ % ^ & * ( ) _ + - = [ ] { } | ; : ' " , . / < > ? ~ \` \\`,
  sql:        `' " ; -- /* */ UNION SELECT DROP TABLE INSERT UPDATE DELETE WHERE OR AND`,
  xss:        `< > " ' & / \\ = { } ( ) ; <script> </script> onerror= onload= alert(`,
  path:       `.. / \\ % ~ $ ../../../ ..\\..\\..\\  %2e%2e%2f %252e%252e%252f`,
  unicode:    `© ® ™ ° ± × ÷ µ ¶ § ¡ ¿ — – … « » ← → ↑ ↓ ★ ☆ ✓ ✗ ñ ü ö ä é è`,
  diacritics: `à á â ã ä å ç è é ê ë ì í î ï ñ ò ó ô õ`,
  symbols:    `© ® ™ ° § ¶ † ‡ • … ‰ ′ ″ ‴ ← → ↑ ↓ ↔ ↕`,
  currency:   `$ € £ ¥ ¢ ₹ ₩ ₪ ₫ ₺ ₽ ₿ ฿ ₴ ₲ ₳ ₵ ₱ ₭ ₮`,
  accented:   `ā ă ą ć ĉ ċ č ď đ ē ĕ ė ę ě ĝ ğ ġ ģ ĥ ħ`,
  emoji:      `😀 😂 😍 🤔 😢 😡 👍 👎 🔥 💯 🎉 🚀 💔 🌟 🙈 🤦 🎁 🔑 💡 ⚠️`,
  math:       `∑ ∏ ∫ ∂ ∇ √ ∞ ≈ ≠ ≤ ≥ ∈ ∉ ∩ ∪ ⊂ ⊃ ∀ ∃ ∄`,
};

function setOutput(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = value;
  el.classList.toggle('is-empty', !value || value === '—');
}

function initTestStrings() {
  // Random Number
  document.getElementById('rn-generate').addEventListener('click', () => {
    const min = parseInt(document.getElementById('rn-min').value, 10);
    const max = parseInt(document.getElementById('rn-max').value, 10);
    const lo = Math.min(min, max);
    const hi = Math.max(min, max);
    const num = Math.floor(Math.random() * (hi - lo + 1)) + lo;
    const pad = document.getElementById('rn-prefix-zeros').checked;
    setOutput('rn-output', pad ? String(num).padStart(String(hi).length, '0') : String(num));
  });

  // Random String
  document.getElementById('rs-generate').addEventListener('click', () => {
    const length = Math.min(128, Math.max(1, parseInt(document.getElementById('rs-length').value, 10) || 12));
    let charset = '';
    if (document.getElementById('rs-upper').checked)   charset += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    if (document.getElementById('rs-lower').checked)   charset += 'abcdefghijklmnopqrstuvwxyz';
    if (document.getElementById('rs-digits').checked)  charset += '0123456789';
    if (document.getElementById('rs-symbols').checked) charset += '!@#$%^&*()_+-=[]{}|;:\'\",./<>?';
    if (!charset) charset = 'abcdefghijklmnopqrstuvwxyz';
    let result = '';
    for (let i = 0; i < length; i++) result += charset[Math.floor(Math.random() * charset.length)];
    setOutput('rs-output', result);
  });

  // Special Characters preset
  const scPreset = document.getElementById('sc-preset');
  function updateSpecialChars() {
    setOutput('sc-output', SPECIAL_CHAR_PRESETS[scPreset.value] || SPECIAL_CHAR_PRESETS.common);
  }
  scPreset.addEventListener('change', updateSpecialChars);
  updateSpecialChars();

  // Copy buttons — event delegation so dynamically added rows are covered
  document.addEventListener('click', e => {
    const btn = e.target.closest('[data-copy]');
    if (!btn) return;
    const target = document.getElementById(btn.dataset.copy);
    const text = (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA')
      ? target.value.trim()
      : target?.textContent?.trim();
    if (!text || text === '—') return;
    navigator.clipboard.writeText(text).then(() => {
      const orig = btn.textContent;
      btn.textContent = '✓';
      setTimeout(() => { btn.textContent = orig; }, 1500);
    });
  });
}

const ENV_URL_PROP = {
  TEST:  'testUrl',
  UAT:   'uatUrl',
  PROD:  'prodUrl',
  INT:   'intUrl',
  PPE:   'ppeUrl',
  STAGE: 'stageUrl',
};

function initSiteUrls() {
  let baseUrlOverride = null;

  function setSiteUrl(id, url) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = url || '—';
    el.classList.toggle('is-empty', !url);
    el.href = url || '#';
  }

  function renderAlternateUrls(urls) {
    const container = document.getElementById('su-alternate-urls');
    if (!container) return;
    container.innerHTML = '';
    if (!urls.length) {
      container.innerHTML = '<div class="util-output-row"><span class="util-output is-empty">—</span></div>';
      return;
    }
    urls.forEach((url, i) => {
      const display = url.replace(/\/olsso\/?$/i, '').replace(/\/+$/, '');
      const id  = `su-alt-url-${i}`;
      const row = document.createElement('div');
      row.className = 'util-output-row';
      row.innerHTML = `
        <span class="util-output" id="${id}">${display}</span>
        <button class="copy-btn" data-copy="${id}">Copy</button>
        <button class="copy-btn" data-use-base="${i}">Use as BaseURL</button>`;
      row.querySelector('[data-use-base]').addEventListener('click', () => {
        baseUrlOverride = url;
        update();
      });
      container.appendChild(row);
    });
  }

  function update() {
    const customer = getSelectedCustomer();
    const env      = document.getElementById('env-select')?.value;
    const raw      = customer?.[ENV_URL_PROP[env]];
    const rawUrls    = raw ? raw.split(',').map(u => u.trim()).filter(Boolean) : [];
    const rawBaseUrl = (baseUrlOverride && rawUrls.includes(baseUrlOverride)) ? baseUrlOverride : (rawUrls[0] ?? null);
    const alternateUrls = rawUrls.filter(u => u !== rawBaseUrl);
    const recordId = document.getElementById('su-asset-record-id')?.value.trim() ?? '';
    const baseUrl  = rawBaseUrl ? rawBaseUrl.replace(/\/olsso\/?$/i, '').replace(/\/+$/, '') : null;
    setSiteUrl('su-baseurl',     baseUrl || null);
    renderAlternateUrls(alternateUrls);
    setSiteUrl('su-olsso',       baseUrl ? baseUrl + '/OLSSO' : null);
    setSiteUrl('su-configdiff',  baseUrl ? baseUrl + '/CS.aspx?VP3=ParamDiff&Profile=COR&Module=ActivatedModules_BO' : null);
    setOutput('su-runchecks',    baseUrl ? baseUrl + '/API/Monitoring/v1.0/RunChecks' : '—');
    setOutput('su-assetversion', baseUrl ? baseUrl + '/webapi/mediafile/assetfile/getassetversions_4FS_v1?RecordID=' + recordId : '—');
    setSiteUrl('su-qcping',       baseUrl ? baseUrl + '/API/QualityControl/v1.0/Ping?format=JSON' : null);
    setSiteUrl('su-swagger-asset',  baseUrl ? baseUrl + '/swagger/index.html?urls.primaryName=search#/SearchEngine/get_webapi_search_searchengine_troubleshooting_get_index_43D_v1' : null);
    setSiteUrl('su-docker-history', baseUrl ? baseUrl + '/C.aspx?VP3=CortexUpgradeDocker_History' : null);
  }

  function resetAndUpdate() {
    const recordIdEl = document.getElementById('su-asset-record-id');
    if (recordIdEl) recordIdEl.value = '';
    baseUrlOverride = null;
    update();
  }

  document.addEventListener('customer:selected', resetAndUpdate);
  document.getElementById('env-select')?.addEventListener('change', resetAndUpdate);
  document.getElementById('su-asset-record-id')?.addEventListener('input', update);
  update();
}

const AC_HEADERS_OF_INTEREST = [
  'content-type', 'x-frame-options', 'content-security-policy',
  'cache-control', 'location', 'server', 'x-powered-by',
  'strict-transport-security', 'access-control-allow-origin',
];

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function initApiChecks() {
  const urlInput  = document.getElementById('ac-url');
  const runBtn    = document.getElementById('ac-run');
  const resultsEl = document.getElementById('ac-results');
  const codeEl    = document.getElementById('ac-response-code');
  const bodyEl    = document.getElementById('ac-response-body');

  function clearResults() {
    codeEl.textContent = '—';
    codeEl.className = 'util-output is-empty';
    bodyEl.value = '';
  }

  function syncAcUrl() {
    const url = document.getElementById('su-runchecks')?.textContent?.trim();
    if (!url || url === '—') return;
    urlInput.value = url;
    clearResults();
  }

  document.addEventListener('customer:selected', syncAcUrl);
  document.getElementById('env-select')?.addEventListener('change', syncAcUrl);

  async function runChecks() {
    const url = urlInput.value.trim();
    if (!url) return;

    clearResults();
    const spinner = document.createElement('div');
    spinner.className = 'ac-running';
    spinner.innerHTML = '<div class="ac-spinner"></div><span>Checking…</span>';
    resultsEl.replaceChildren(spinner);
    runBtn.disabled = true;

    const t0 = performance.now();
    try {
      const resp = await fetch(url, { method: 'GET' });
      const responseTime = Math.round(performance.now() - t0);
      const body = await resp.text();
      resultsEl.replaceChildren();
      renderAcResult({ ok: resp.ok, status: resp.status, statusText: resp.statusText, responseTime, body });
    } catch (err) {
      const responseTime = Math.round(performance.now() - t0);
      resultsEl.replaceChildren();
      renderAcResult({ ok: false, error: err.message, responseTime });
    } finally {
      runBtn.disabled = false;
    }
  }

  function statusClass(status) {
    if (!status)      return 'error';
    if (status < 300) return 'ok';
    if (status < 400) return 'redir';
    return 'error';
  }

  function formatBody(raw) {
    if (!raw) return null;
    try {
      return JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      return raw;
    }
  }

  function renderAcResult(data) {
    const cls = statusClass(data.status);
    codeEl.textContent = data.error
      ? `Error — ${data.error}`
      : `${data.status} ${data.statusText || ''} — ${data.responseTime}ms`.trim();
    codeEl.className = `util-output ac-status-${cls}`;
    bodyEl.value = data.error
      ? data.error
      : (formatBody(data.body) ?? '(empty response)');
  }

  runBtn.addEventListener('click', runChecks);
  urlInput.addEventListener('keydown', e => { if (e.key === 'Enter') runChecks(); });
}

const EMBED_BG = {
  dark:   '#0a0c10',
  white:  '#ffffff',
  light:  '#e5e7eb',
  mid:    '#6b7280',
  black:  '#000000',
  red:    '#ef4444',
  blue:   '#3b82f6',
  green:  '#22c55e',
  yellow: '#eab308',
};

function initEmbedChecks() {
  const urlInput = document.getElementById('ec-url');
  const loadBtn  = document.getElementById('ec-load');
  const img      = document.getElementById('ec-img');
  const wrapper  = document.getElementById('ec-frame-wrapper');
  const empty    = document.getElementById('ec-empty');
  const error    = document.getElementById('ec-error');

  function loadImage() {
    const url = urlInput.value.trim();
    if (!url) return;
    empty.hidden = true;
    error.hidden = true;
    img.hidden   = true;
    img.src      = url;
  }

  img.addEventListener('load',  () => { img.hidden = false; error.hidden = true; });
  img.addEventListener('error', () => { img.hidden = true;  error.hidden = false; });

  loadBtn.addEventListener('click', loadImage);
  urlInput.addEventListener('keydown', e => { if (e.key === 'Enter') loadImage(); });

  document.querySelectorAll('#ec-swatches .embed-swatch').forEach(swatch => {
    swatch.addEventListener('click', () => {
      document.querySelectorAll('#ec-swatches .embed-swatch').forEach(s => s.classList.remove('is-active'));
      swatch.classList.add('is-active');
      const bg = swatch.dataset.bg;
      wrapper.classList.toggle('bg-check', bg === 'check');
      wrapper.style.backgroundColor = bg !== 'check' ? (EMBED_BG[bg] ?? '') : '';
    });
  });
}

function initUsefulStrings() {
  const container  = document.getElementById('su-email-fields');
  const emailInput = document.getElementById('su-email');
  let counter = 0;

  function syncEmail() {
    const user = document.getElementById('user-select')?.value ?? '';
    emailInput.value = user ? `${user}@OrangeLogic.com` : '@OrangeLogic.com';
  }

  syncEmail();
  document.getElementById('user-select')?.addEventListener('change', syncEmail);

  document.getElementById('su-email-add').addEventListener('click', () => {
    counter++;
    const id           = `su-email-${counter}`;
    const lastInput    = container.querySelectorAll('input[type="email"]');
    const currentEmail = lastInput[lastInput.length - 1]?.value ?? '';
    const row = document.createElement('div');
    row.className = 'util-field-row';
    row.innerHTML = `
      <input class="field-input" type="email" id="${id}" value="${currentEmail.replace(/"/g, '&quot;')}">
      <button class="copy-btn" data-copy="${id}">Copy</button>
      <button class="util-remove-btn" title="Remove">−</button>`;
    row.querySelector('.util-remove-btn').addEventListener('click', () => row.remove());
    container.appendChild(row);
    row.querySelector('input').focus();
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initEnvironmentSelects();
  initClientSelects();
  initClock();
  initHeaderSync();
  initCollapsibles();
  initTestStrings();
  initSiteUrls();
  initUsefulStrings();
  initApiChecks();
  initEmbedChecks();
});
