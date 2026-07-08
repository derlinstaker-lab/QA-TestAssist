/**
 * linkData.js — renders the "Link Data" panel for the selected customer.
 * Reads only from /api/link-data/:customerName; never talks to Link directly.
 *
 * Note: Link Customer-record fields are not synced in this build (Task 1's
 * spike found no reliable query pattern for them) — this module only
 * renders the recent-tickets sub-panel.
 */

import { getSelectedCustomer } from './customerSelect.js';

const COPY_LABEL = 'Copy Sync Command';
const COPIED_LABEL = 'Copied!';
const COPIED_RESET_MS = 1500;

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

async function loadLinkData(customer) {
  updateSyncButton(customer);

  const syncBadge = document.getElementById('link-data-synced');
  const tasksBody = document.getElementById('link-tasks-tbody');
  if (!syncBadge || !tasksBody) return;

  if (customer.customerName.startsWith('QA-')) {
    syncBadge.textContent = 'Not synced (excluded)';
    renderTasks(tasksBody, []);
    return;
  }

  try {
    const resp = await fetch(`/api/link-data/${encodeURIComponent(customer.customerName)}`);
    if (!resp.ok) throw new Error(`Link data API error: ${resp.status}`);
    const data = await resp.json();
    syncBadge.textContent = data.syncedAt ? `Last synced: ${formatSyncedAt(data.syncedAt)}` : 'Never synced';
    renderTasks(tasksBody, data.tasks || []);
  } catch (err) {
    console.warn('Link data unavailable:', err.message);
    syncBadge.textContent = 'Never synced';
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
  document.addEventListener('customer:selected', e => loadLinkData(e.detail));
  document.getElementById('link-data-sync-btn')?.addEventListener('click', copySyncCommand);
}
