/**
 * clock.js — Live timestamp in the header
 */

export function initClock() {
  const el = document.getElementById('clock');
  if (!el) return;

  function tick() {
    el.textContent = new Date().toTimeString().slice(0, 8);
    setTimeout(tick, 1000);
  }
  tick();
}
