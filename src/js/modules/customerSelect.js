import { loadCustomers } from '../data/customers.js';

const CLIENT_SELECT_IDS = ['r-customer'];
const STORAGE_KEY_CUSTOMER = 'qa-dashboard:customer';
let _customers = [];
let _selected  = null;
let _mode      = null;   // null | 'edit' | 'create'

// Drives both the view display and the edit form
const FIELDS = [
  { id: null,         prop: 'customerName',     label: 'Customer Name',            type: 'text'     },
  { id: 'cs-poc',     prop: 'olPoc',             label: 'OL POC',                  type: 'text'     },
  { id: 'cs-csm',     prop: 'csm',               label: 'Customer Success Manager', type: 'text'     },
  { id: 'cs-pm',      prop: 'pm',                label: 'Project Manager',          type: 'text'     },
  { id: 'cs-impl',    prop: 'implementation',    label: 'Implementation Lead',      type: 'text'     },
  { id: 'cs-release', prop: 'releaseName',       label: 'Release',                  type: 'text'     },
  { id: 'cs-kb',      prop: 'kbArticle',         label: 'KB Article',               type: 'text'     },
  { id: 'cs-launched',prop: 'launched',          label: 'Launched',                 type: 'bool'     },
  { id: 'cs-launch',  prop: 'launchDate',        label: 'Launch Date',              type: 'text'     },
  { id: null,         prop: 'status',            label: 'Status',                   type: 'select',
    opts: ['Implementation', 'Support', 'Active SOW'], editOnly: true },
  { id: 'cs-prod',    prop: 'prodUrl',           label: 'Production URL',           type: 'textarea', wide: true },
  { id: 'cs-test',    prop: 'testUrl',           label: 'Test URL',                 type: 'textarea', wide: true },
  { id: 'cs-uat',     prop: 'uatUrl',            label: 'UAT URL',                  type: 'textarea', wide: true },
  { id: 'cs-int',     prop: 'intUrl',            label: 'INT URL',                  type: 'textarea', wide: true },
  { id: 'cs-ppe',     prop: 'ppeUrl',            label: 'PPE URL',                  type: 'textarea', wide: true },
  { id: 'cs-stage',   prop: 'stageUrl',          label: 'Stage URL',                type: 'textarea', wide: true },
];

// ── Dropdown population ──────────────────────────────

function buildOptions(customers) {
  return [...customers]
    .sort((a, b) => a.customerName.localeCompare(b.customerName))
    .map(c => {
      const opt = document.createElement('option');
      opt.value       = c.customerName;
      opt.textContent = c.customerName;
      return opt;
    });
}

function populateSelects(customers) {
  const options = buildOptions(customers);
  CLIENT_SELECT_IDS.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.replaceChildren(...options.map(o => o.cloneNode(true)));
  });
}

function getSelected() {
  return _selected;
}

// ── Customer table ───────────────────────────────────

const STATUS_CLASS = {
  'Support':        'ct-status--support',
  'Implementation': 'ct-status--impl',
  'Active SOW':     'ct-status--sow',
};

function renderCustomerTable(filter = '') {
  const tbody = document.getElementById('customers-tbody');
  const countEl = document.getElementById('customers-count');
  if (!tbody) return;

  const q = filter.trim().toLowerCase();
  const visible = q
    ? _customers.filter(c =>
        c.customerName.toLowerCase().includes(q) ||
        (c.status      || '').toLowerCase().includes(q) ||
        (c.olPoc       || '').toLowerCase().includes(q) ||
        (c.csm         || '').toLowerCase().includes(q) ||
        (c.releaseName || '').toLowerCase().includes(q)
      )
    : _customers;

  if (!visible.length) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state">
      <div class="empty-title">No customers match</div></div></td></tr>`;
    if (countEl) countEl.textContent = '0';
    return;
  }

  const selected = getSelected();
  tbody.replaceChildren(...visible.map(c => buildTableRow(c, selected?.customerName)));
  if (countEl) countEl.textContent =
    q ? `${visible.length} / ${_customers.length}` : String(_customers.length);
}

function urlCell(raw) {
  const urls = (raw || '').split(',').map(u => u.trim()).filter(Boolean);
  if (!urls.length) return '—';
  return urls
    .map(u => `<a href="${u}" target="_blank" rel="noopener" class="ct-url">${u}</a>`)
    .join('<br>');
}

function buildTableRow(c, activeName) {
  const tr = document.createElement('tr');
  tr.dataset.name = c.customerName;
  if (c.customerName === activeName) tr.classList.add('ct-row--active');

  tr.addEventListener('click', () => {
    if (_mode) exitMode();
    selectCustomer(c);
  });

  const cells = [
    { text: c.customerName, cls: 'ct-name' },
    { html: `<span class="ct-status ${STATUS_CLASS[c.status] || ''}">${c.status || '—'}</span>` },
    { text: c.olPoc       || '—' },
    { text: c.releaseName || '—' },
    { html: urlCell(c.prodUrl) },
    { html: urlCell(c.testUrl) },
    { html: urlCell(c.uatUrl) },
    { text: c.kbArticle || '—' },
  ];

  cells.forEach(({ text, html, cls }) => {
    const td = document.createElement('td');
    if (cls) td.className = cls;
    if (html) td.innerHTML = html;
    else td.textContent = text;
    tr.appendChild(td);
  });

  return tr;
}

function highlightTableRow(customerName) {
  let activeRow = null;
  document.querySelectorAll('#customers-tbody tr').forEach(tr => {
    const isActive = tr.dataset.name === customerName;
    tr.classList.toggle('ct-row--active', isActive);
    if (isActive) activeRow = tr;
  });
  if (activeRow) activeRow.scrollIntoView({ block: 'nearest' });
}

function selectCustomer(c) {
  _selected = c;
  localStorage.setItem(STORAGE_KEY_CUSTOMER, c.customerName);
  const input = document.getElementById('customer-input');
  if (input) input.value = c.customerName;
  CLIENT_SELECT_IDS.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = c.customerName;
  });
  highlightTableRow(c.customerName);
  renderSummary(c);
  document.dispatchEvent(new CustomEvent('customer:selected', { detail: c }));
}

export function getSelectedCustomer() { return _selected; }

function initAutocomplete() {
  const input = document.getElementById('customer-input');
  const list  = document.getElementById('customer-list');
  if (!input || !list) return;

  let activeIdx = -1;
  let filtered  = [];

  function renderList(customers) {
    filtered  = customers;
    activeIdx = -1;
    list.replaceChildren(...filtered.map(c => {
      const li = document.createElement('li');
      li.className    = 'autocomplete-item';
      li.textContent  = c.customerName;
      li.dataset.name = c.customerName;
      li.addEventListener('mousedown', e => {
        e.preventDefault();
        selectCustomer(c);
        list.hidden = true;
      });
      return li;
    }));
    list.hidden = !filtered.length;
  }

  function setActive(idx) {
    const items = list.querySelectorAll('.autocomplete-item');
    items.forEach((el, i) => el.classList.toggle('autocomplete-item--active', i === idx));
    if (items[idx]) items[idx].scrollIntoView({ block: 'nearest' });
    activeIdx = idx;
  }

  input.addEventListener('focus', () => renderList(_customers));

  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    renderList(q
      ? _customers.filter(c => c.customerName.toLowerCase().includes(q))
      : _customers
    );
  });

  input.addEventListener('blur', () => {
    list.hidden  = true;
    input.value  = _selected?.customerName || '';
  });

  input.addEventListener('keydown', e => {
    if (list.hidden) return;
    const count = filtered.length;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(Math.min(activeIdx + 1, count - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(Math.max(activeIdx - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIdx >= 0 && filtered[activeIdx]) {
        selectCustomer(filtered[activeIdx]);
        list.hidden = true;
      }
    } else if (e.key === 'Escape') {
      list.hidden = true;
      input.value = _selected?.customerName || '';
    }
  });
}

// ── View rendering ───────────────────────────────────

function setLinks(id, raw) {
  const el = document.getElementById(id);
  if (!el) return;
  const urls = (raw || '').split(',').map(u => u.trim()).filter(Boolean);
  if (!urls.length) { el.textContent = '—'; return; }
  el.innerHTML = urls
    .map(u => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`)
    .join('<br>');
}

function renderSummary(customer) {
  const panel = document.getElementById('client-summary');
  if (!panel) return;
  panel.hidden = false;

  const has = !!(customer?.uniqueId);

  document.getElementById('cs-name').textContent = has ? customer.customerName : '—';
  document.getElementById('cs-id').textContent   = has ? customer.uniqueId    : '—';

  const badge = document.getElementById('cs-status-badge');
  if (badge) {
    badge.textContent = has ? (customer.status || '—') : '—';
    badge.className   = 'panel-badge ' +
      (customer?.status === 'Support' ? 'badge-green' : 'badge-cyan');
  }

  FIELDS.filter(f => !f.editOnly && f.id).forEach(f => {
    const el = document.getElementById(f.id);
    if (!el) return;
    if (!has) { el.textContent = '—'; return; }
    if (f.type === 'textarea') {
      setLinks(f.id, customer[f.prop]);
    } else if (f.type === 'bool') {
      el.textContent = customer[f.prop] === true  ? 'Yes'
                     : customer[f.prop] === false ? 'No' : '—';
    } else {
      el.textContent = customer[f.prop] || '—';
    }
  });

  document.getElementById('cs-new-btn')?.removeAttribute('hidden');
  const editBtn = document.getElementById('cs-edit-btn');
  if (editBtn) editBtn.hidden = !has;
  document.getElementById('cs-save-btn').hidden   = true;
  document.getElementById('cs-cancel-btn').hidden = true;
}

// ── Edit form ────────────────────────────────────────

function buildFormField(f, customer) {
  const wrap = document.createElement('div');
  wrap.className = 'cs-field' + (f.wide ? ' cs-field--wide' : '');

  const label = document.createElement('label');
  label.className   = 'cs-label';
  label.htmlFor     = 'ef-' + f.prop;
  label.textContent = f.label;
  wrap.appendChild(label);

  const val = customer[f.prop];
  let input;

  if (f.type === 'textarea') {
    input = document.createElement('textarea');
    input.className = 'cs-textarea';
    input.value = val || '';
    input.rows  = 2;
  } else if (f.type === 'select') {
    input = document.createElement('select');
    input.className = 'cs-select';
    f.opts.forEach(opt => {
      const o = document.createElement('option');
      o.value = opt; o.textContent = opt || '—';
      o.selected = (val || '') === opt;
      input.appendChild(o);
    });
  } else if (f.type === 'bool') {
    input = document.createElement('select');
    input.className = 'cs-select';
    [['', '—'], ['true', 'Yes'], ['false', 'No']].forEach(([v, lbl]) => {
      const o = document.createElement('option');
      o.value = v; o.textContent = lbl;
      o.selected = v === (val == null ? '' : String(val));
      input.appendChild(o);
    });
  } else if (f.type === 'number') {
    input = document.createElement('input');
    input.type = 'number'; input.className = 'cs-input';
    input.value = val != null ? val : '';
    if (f.min  != null) input.min  = f.min;
    if (f.max  != null) input.max  = f.max;
    if (f.step != null) input.step = f.step;
  } else {
    input = document.createElement('input');
    input.type = 'text'; input.className = 'cs-input';
    input.value = val || '';
  }

  input.id           = 'ef-' + f.prop;
  input.dataset.prop = f.prop;
  input.dataset.type = f.type;
  wrap.appendChild(input);
  return wrap;
}

function openForm(customer, mode) {
  _mode = mode;

  const form = document.getElementById('cs-form');
  // For edit, exclude customerName from form (shown in header read-only)
  const formFields = mode === 'create'
    ? FIELDS
    : FIELDS.filter(f => f.prop !== 'customerName');
  form.replaceChildren(...formFields.map(f => buildFormField(f, customer)));
  form.hidden = false;
  document.getElementById('cs-view').hidden = true;

  document.getElementById('cs-new-btn').hidden    = true;
  document.getElementById('cs-edit-btn').hidden   = true;
  document.getElementById('cs-save-btn').hidden   = false;
  document.getElementById('cs-cancel-btn').hidden = false;

  const statusEl = document.getElementById('cs-save-status');
  if (statusEl) statusEl.hidden = true;
}

function enterEditMode(customer)  { openForm(customer, 'edit'); }
function enterCreateMode()        { openForm({},       'create'); }

function exitMode() {
  _mode = null;

  const form = document.getElementById('cs-form');
  form.hidden = true;
  form.replaceChildren();

  document.getElementById('cs-view').hidden = false;
  renderSummary(_selected);
}

function collectEdits() {
  const data = {};
  document.querySelectorAll('#cs-form [data-prop]').forEach(input => {
    const { prop, type } = input.dataset;
    const raw = input.value.trim();
    if (type === 'bool') {
      data[prop] = raw === 'true' ? true : raw === 'false' ? false : null;
    } else if (type === 'number') {
      data[prop] = raw === '' ? null : parseFloat(raw);
    } else {
      data[prop] = raw === '' ? null : raw;
    }
  });
  return data;
}

async function saveCustomer() {
  const data     = collectEdits();
  const saveBtn  = document.getElementById('cs-save-btn');
  const statusEl = document.getElementById('cs-save-status');
  const creating = _mode === 'create';

  if (creating && !data.customerName?.trim()) {
    if (statusEl) {
      statusEl.textContent = 'Customer Name is required.';
      statusEl.className   = 'cs-save-status cs-save-err';
      statusEl.hidden      = false;
    }
    return;
  }

  saveBtn.disabled    = true;
  saveBtn.textContent = 'Saving…';

  try {
    const url    = creating
      ? '/api/customers'
      : `/api/customers/${encodeURIComponent(_selected.uniqueId)}`;
    const method = creating ? 'POST' : 'PATCH';

    const resp = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify(data),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: resp.statusText }));
      throw new Error(err.error || resp.statusText);
    }

    const saved = await resp.json();

    if (creating) {
      _customers.push(saved);
      _customers.sort((a, b) => a.customerName.localeCompare(b.customerName));
      populateSelects(_customers);
      renderCustomerTable();
    } else {
      const idx = _customers.findIndex(c => c.uniqueId === saved.uniqueId);
      if (idx !== -1) _customers[idx] = saved;
      const oldRow = document.querySelector(`#customers-tbody tr[data-name="${CSS.escape(_selected.customerName)}"]`);
      if (oldRow) oldRow.replaceWith(buildTableRow(saved, saved.customerName));
    }

    _selected = saved;
    exitMode();
    selectCustomer(saved);

    if (statusEl) {
      statusEl.textContent = creating ? 'Customer created' : 'Changes saved';
      statusEl.className   = 'cs-save-status cs-save-ok';
      statusEl.hidden      = false;
      setTimeout(() => { statusEl.hidden = true; }, 3000);
    }
  } catch (err) {
    if (statusEl) {
      statusEl.textContent = `Save failed: ${err.message}`;
      statusEl.className   = 'cs-save-status cs-save-err';
      statusEl.hidden      = false;
    }
  } finally {
    saveBtn.disabled    = false;
    saveBtn.textContent = 'Save';
  }
}

// ── Init ─────────────────────────────────────────────

export async function initClientSelects() {
  try {
    _customers = await loadCustomers();
  } catch (err) {
    console.warn('Customer data unavailable:', err.message);
    const tbody = document.getElementById('customers-tbody');
    if (tbody) tbody.innerHTML =
      `<tr><td colspan="6"><div class="empty-state">
        <div class="empty-title">Could not load customers</div>
        <div class="empty-sub">${err.message}</div>
      </div></td></tr>`;
    return;
  }

  _customers.sort((a, b) => a.customerName.localeCompare(b.customerName));
  populateSelects(_customers);
  renderCustomerTable();
  initAutocomplete();

  const savedName = localStorage.getItem(STORAGE_KEY_CUSTOMER);
  const defaultCustomer = (savedName && _customers.find(c => c.customerName === savedName))
    || _customers.find(c => c.customerName.toLowerCase().includes('queenstown'));
  if (defaultCustomer) selectCustomer(defaultCustomer);

  document.getElementById('r-customer')?.addEventListener('change', e => {
    const name = e.target.value;
    const c = _customers.find(c => c.customerName === name) ?? null;
    if (_mode) exitMode();
    if (c) selectCustomer(c);
  });

  document.getElementById('customer-search')?.addEventListener('input', e => {
    renderCustomerTable(e.target.value);
  });

  document.getElementById('cs-new-btn')?.addEventListener('click', () => {
    if (_mode) exitMode();
    enterCreateMode();
  });

  document.getElementById('cs-edit-btn')?.addEventListener('click', () => {
    const c = getSelected();
    if (c) enterEditMode(c);
  });

  document.getElementById('cs-save-btn')?.addEventListener('click', saveCustomer);

  document.getElementById('cs-cancel-btn')?.addEventListener('click', exitMode);

  document.getElementById('customers-refresh-btn')?.addEventListener('click', refreshCustomers);
}

async function refreshCustomers() {
  const btn = document.getElementById('customers-refresh-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Refreshing…'; }
  try {
    _customers = await loadCustomers();
    _customers.sort((a, b) => a.customerName.localeCompare(b.customerName));
    populateSelects(_customers);
    renderCustomerTable(document.getElementById('customer-search')?.value ?? '');
  } catch (err) {
    console.warn('Customer refresh failed:', err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Refresh'; }
  }
}
