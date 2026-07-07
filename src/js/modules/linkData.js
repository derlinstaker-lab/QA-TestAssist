/**
 * linkData.js — renders the "Link Data" panel for the selected customer.
 * Reads only from /api/link-data/:customerName; never talks to Link directly.
 *
 * Note: Link Customer-record fields are not synced in this build (Task 1's
 * spike found no reliable query pattern for them) — this module only
 * renders the recent-tickets sub-panel.
 */

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

async function loadLinkData(customer) {
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

export function initLinkData() {
  document.addEventListener('customer:selected', e => loadLinkData(e.detail));
}
