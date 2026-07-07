/**
 * activity.js — Renders the activity feed panel
 */

import { ACTIVITY_EVENTS } from '../data/activity.js';

/**
 * Build the HTML for one activity item.
 * @param {import('../data/activity.js').ActivityEvent} event
 * @returns {string}
 */
function renderActivityItem({ icon, iconClass, text, time }) {
  return `
    <div class="activity-item">
      <div class="activity-icon ${iconClass}">${icon}</div>
      <div>
        <div class="activity-text">${text}</div>
        <div class="activity-time">${time}</div>
      </div>
    </div>`;
}

export function initActivity() {
  const list  = document.getElementById('activity-list');
  const badge = document.getElementById('activity-badge');
  if (!list) return;

  if (ACTIVITY_EVENTS.length) {
    list.innerHTML = ACTIVITY_EVENTS.map(renderActivityItem).join('');
    if (badge) badge.textContent = `${ACTIVITY_EVENTS.length} events`;
  } else {
    list.innerHTML = '<div class="empty-state"><div class="empty-title">No activity</div><div class="empty-sub">Events will appear here when tests run</div></div>';
    if (badge) badge.textContent = '—';
  }
}
