/**
 * stats.js — Renders KPI stat cards into #stats-grid
 */

import { STATS } from '../data/stats.js';

/**
 * Build the HTML for a single stat card.
 * @param {import('../data/stats.js').StatItem} stat
 * @returns {string}
 */
function renderStatCard({ label, value, colorClass, change }) {
  return `
    <div class="stat-card">
      <div class="stat-label">${label}</div>
      <div class="stat-value ${colorClass}">${value}</div>
      <div class="stat-change">${change}</div>
    </div>`;
}

export function initStats() {
  const grid = document.getElementById('stats-grid');
  if (!grid) return;
  grid.innerHTML = STATS.length ? STATS.map(renderStatCard).join('') : '';
  grid.hidden = !STATS.length;
}
