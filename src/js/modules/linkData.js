/**
 * linkData.js — renders the "Link Data" panel for the selected customer.
 * Reads only from /api/link-data/:customerName; never talks to Link directly.
 * "Get from Link" asks the server to run a headless Claude Code sync
 * (/api/link-data/:customerName/sync) and polls it until it finishes.
 *
 * "Link Customer Fields" shows Link's raw per-customer account data,
 * uncurated — see
 * docs/superpowers/specs/2026-07-08-link-customer-fields-revival-design.md.
 * "Recent Link Tickets" shows the last synced 14-day ticket window.
 */

import { getSelectedCustomer } from './customerSelect.js';

const COPY_LABEL = 'Copy Sync Command';
const COPIED_LABEL = 'Copied!';
const COPIED_RESET_MS = 1500;
const FETCH_LABEL = 'Get from Link';
const FETCHING_LABEL = 'Getting from Link…';
const SYNC_POLL_MS = 5000;

let syncPollTimer = null;

function stripHtml(str) {
  return String(str).replace(/<[^>]*>/g, '');
}

function displayValue(raw) {
  if (raw === null || raw === undefined || raw === '') return '—';
  if (Array.isArray(raw)) {
    const parts = raw.map(displayValue).filter(v => v !== '—');
    return parts.length ? parts.join(', ') : '—';
  }
  if (typeof raw === 'object') {
    return raw.Value !== undefined ? displayValue(raw.Value) : '—';
  }
  const text = stripHtml(String(raw)).trim();
  return text || '—';
}

function renderFields(container, fields) {
  container.replaceChildren();
  if (!fields) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = '<div class="empty-title">No data</div>';
    container.appendChild(empty);
    return;
  }
  Object.entries(fields).forEach(([key, value]) => {
    const field = document.createElement('div');
    field.className = 'cs-field';
    const labelEl = document.createElement('span');
    labelEl.className = 'cs-label';
    labelEl.textContent = key;
    const valueEl = document.createElement('span');
    valueEl.className = 'cs-value';
    valueEl.textContent = displayValue(value);
    field.append(labelEl, valueEl);
    container.appendChild(field);
  });
}

function renderTasks(tbody, tasks) {
  if (!tasks.length) {
    tbody.innerHTML = '<tr><td colspan="5"><div class="empty-state"><div class="empty-title">No recent tickets</div></div></td></tr>';
    return;
  }
  tbody.replaceChildren(...tasks.map(t => {
    const tr = document.createElement('tr');
    [t.taskPath, t.taskType, t.status, t.totalMinutes, t.teams].forEach(value => {
      const td = document.createElement('td');
      td.textContent = (value === null || value === undefined || value === '') ? '—' : String(value);
      tr.appendChild(td);
    });
    return tr;
  }));
}

function formatSyncedAt(iso) {
  return iso ? new Date(iso).toLocaleString() : null;
}

function updateSyncButton(customer) {
  const btn = document.getElementById('link-data-sync-btn');
  if (!btn) return;
  btn.disabled = customer.customerName.startsWith('QA-');
  btn.textContent = COPY_LABEL;
}

function setFetchButton(customer, running) {
  const btn = document.getElementById('link-data-fetch-btn');
  if (!btn) return;
  btn.disabled = running || !customer || customer.customerName.startsWith('QA-');
  btn.textContent = running ? FETCHING_LABEL : FETCH_LABEL;
}

function minutesSince(iso) {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
}

/** Shows a sync job's state for the selected customer; keeps polling while it runs. */
async function showSyncJob(customer, job) {
  clearTimeout(syncPollTimer);
  if (getSelectedCustomer()?.customerName !== customer.customerName) return;

  const syncBadge = document.getElementById('link-data-synced');
  setFetchButton(customer, job.state === 'running');

  if (job.state === 'running') {
    if (syncBadge) syncBadge.textContent = `Getting from Link… (${minutesSince(job.startedAt)} min, can take 10+)`;
    syncPollTimer = setTimeout(() => pollSyncJob(customer), SYNC_POLL_MS);
    return;
  }
  if (job.state === 'done') {
    await loadLinkData(customer);
    if (syncBadge) syncBadge.title = [job.notes, job.costUsd != null && `Cost: $${job.costUsd.toFixed(2)}`].filter(Boolean).join('\n');
    return;
  }
  if (job.state === 'failed' && syncBadge) {
    syncBadge.textContent = `Link fetch failed: ${job.error}`;
  }
}

async function pollSyncJob(customer) {
  try {
    const resp = await fetch(`/api/link-data/${encodeURIComponent(customer.customerName)}/sync`);
    if (!resp.ok) throw new Error(`Link sync API error: ${resp.status}`);
    await showSyncJob(customer, await resp.json());
  } catch (err) {
    await showSyncJob(customer, { state: 'failed', error: err.message });
  }
}

async function fetchFromLink() {
  const customer = getSelectedCustomer();
  if (!customer) return;
  setFetchButton(customer, true);
  try {
    const resp = await fetch(`/api/link-data/${encodeURIComponent(customer.customerName)}/sync`, { method: 'POST' });
    const job = await resp.json();
    if (!resp.ok && resp.status !== 409) throw new Error(job.error || `Link sync API error: ${resp.status}`);
    await showSyncJob(customer, job);
  } catch (err) {
    await showSyncJob(customer, { state: 'failed', error: err.message });
  }
}

async function loadLinkData(customer) {
  updateSyncButton(customer);
  setFetchButton(customer, false);

  const syncBadge = document.getElementById('link-data-synced');
  const fieldsGrid = document.getElementById('link-fields-grid');
  const tasksBody = document.getElementById('link-tasks-tbody');
  if (!syncBadge || !fieldsGrid || !tasksBody) return;

  if (customer.customerName.startsWith('QA-')) {
    syncBadge.textContent = 'Not synced (excluded)';
    renderFields(fieldsGrid, null);
    renderTasks(tasksBody, []);
    return;
  }

  try {
    const resp = await fetch(`/api/link-data/${encodeURIComponent(customer.customerName)}`);
    if (!resp.ok) throw new Error(`Link data API error: ${resp.status}`);
    const data = await resp.json();
    syncBadge.textContent = data.syncedAt ? `Last synced: ${formatSyncedAt(data.syncedAt)}` : 'Never synced';
    renderFields(fieldsGrid, data.fields);
    renderTasks(tasksBody, data.tasks || []);
  } catch (err) {
    console.warn('Link data unavailable:', err.message);
    syncBadge.textContent = 'Never synced';
    renderFields(fieldsGrid, null);
    renderTasks(tasksBody, []);
  }
}

async function copySyncCommand() {
  const customer = getSelectedCustomer();
  if (!customer) return;
  const btn = document.getElementById('link-data-sync-btn');
  const promptText = `Sync Link data for customer "${customer.customerName}" (single customer only) per docs/link-data-sync-runbook.md.`;

  try {
    await navigator.clipboard.writeText(promptText);
    if (btn) {
      btn.textContent = COPIED_LABEL;
      setTimeout(() => { btn.textContent = COPY_LABEL; }, COPIED_RESET_MS);
    }
  } catch (err) {
    console.warn('Clipboard write failed, falling back to prompt:', err.message);
    window.prompt('Copy this into a Claude Code session:', promptText);
  }
}

export function initLinkData() {
  document.addEventListener('customer:selected', async e => {
    clearTimeout(syncPollTimer);
    await loadLinkData(e.detail);
    // Re-attach to a sync still running for this customer (e.g. after a page reload).
    if (e.detail.customerName.startsWith('QA-')) return;
    try {
      const resp = await fetch(`/api/link-data/${encodeURIComponent(e.detail.customerName)}/sync`);
      const job = resp.ok ? await resp.json() : null;
      if (job?.state === 'running') await showSyncJob(e.detail, job);
    } catch (err) {
      console.warn('Link sync status unavailable:', err.message);
    }
  });
  document.getElementById('link-data-sync-btn')?.addEventListener('click', copySyncCommand);
  document.getElementById('link-data-fetch-btn')?.addEventListener('click', fetchFromLink);
}
