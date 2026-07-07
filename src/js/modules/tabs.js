/**
 * tabs.js — Generic tab-switching for any .tab-btn / .tab-pane group.
 *
 * Usage: wire all [data-tab] buttons inside a container.
 * HTML contract:
 *   <button class="tab-btn" data-tab="results">Results</button>
 *   <div class="tab-pane" id="tab-results"> … </div>
 */

/**
 * Attach click listeners to every .tab-btn inside `container`.
 * @param {HTMLElement} container
 */
export function initTabs(container) {
  if (!container) return;

  container.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab, container));
  });
}

/**
 * Activate the named tab inside `container`.
 * @param {string}      name
 * @param {HTMLElement} container
 */
export function switchTab(name, container) {
  container.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  container.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));

  const pane = document.getElementById(`tab-${name}`);
  const btn  = container.querySelector(`[data-tab="${name}"]`);
  if (pane) pane.classList.add('active');
  if (btn)  btn.classList.add('active');
}
