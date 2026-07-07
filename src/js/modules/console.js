/**
 * console.js — Manages the runner console/log output panel.
 *
 * Intentionally has no knowledge of "runs" — it only knows how to
 * append, clear, and scroll a log element.
 */

const LOG_CLASSES = {
  info   : 'log-info',
  success: 'log-success',
  warn   : 'log-warn',
  error  : 'log-error',
  dim    : 'log-dim',
};

export function initConsole() {
  const clearBtn = document.getElementById('clear-console-btn');
  if (clearBtn) clearBtn.addEventListener('click', clear);
}

/**
 * Append a line to the console log.
 * @param {'info'|'success'|'warn'|'error'|'dim'|''} type
 * @param {string} text
 */
export function log(type, text) {
  const el = document.getElementById('console-log');
  if (!el) return;

  const line = document.createElement('div');
  const cls  = LOG_CLASSES[type];
  if (cls) line.className = cls;
  line.textContent = text;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}

/** Clear all console output. */
export function clear() {
  const el = document.getElementById('console-log');
  if (el) el.innerHTML = '';
}
