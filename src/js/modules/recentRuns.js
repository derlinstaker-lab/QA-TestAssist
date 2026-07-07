/**
 * recentRuns.js — Populates the Recent Test Runs table and progress bar
 */

import { RECENT_RUNS, SUITE_PROGRESS } from '../data/recentRuns.js';

/**
 * Build a <tr> for one test run row.
 * @param {import('../data/recentRuns.js').RunRow} run
 * @returns {string}
 */
function renderRunRow({ name, spec, status, duration, module: mod }) {
  return `
    <tr>
      <td>
        <div class="test-name">${name}</div>
        <div class="test-suite">${spec}</div>
      </td>
      <td><span class="badge ${status}">${status.toUpperCase()}</span></td>
      <td><span class="dur">${duration}</span></td>
      <td><span class="dur">${mod}</span></td>
    </tr>`;
}

export function initRecentRuns() {
  const tbody = document.getElementById('runs-tbody');
  if (tbody) {
    tbody.innerHTML = RECENT_RUNS.length
      ? RECENT_RUNS.map(renderRunRow).join('')
      : '<tr><td colspan="4"><div class="empty-state"><div class="empty-title">No runs yet</div><div class="empty-sub">Results will appear here after a test run</div></div></td></tr>';
  }

  const fill = document.getElementById('progress-fill');
  const pct  = document.getElementById('progress-pct');
  if (fill) fill.style.width = RECENT_RUNS.length ? `${SUITE_PROGRESS}%` : '0%';
  if (pct)  pct.textContent  = RECENT_RUNS.length ? `${SUITE_PROGRESS}%` : '—';
}
