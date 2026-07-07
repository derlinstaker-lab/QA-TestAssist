/**
 * headerSync.js — Keeps the header Env/Suite selects in sync
 * with the runner's Env/Suite selects, and vice-versa.
 */

/** @param {string} sourceId @param {string} targetId */
function bindSync(sourceId, targetId, onChange) {
  const source = document.getElementById(sourceId);
  const target = document.getElementById(targetId);
  if (!source || !target) return;

  source.addEventListener('change', () => {
    target.value = source.value;
    onChange?.();
  });
}

export function initHeaderSync() {
  // Import lazily to avoid circular dependency
  import('../modules/commandBuilder.js').then(({ updateCommandPreview }) => {
    bindSync('env-select', 'r-env',      updateCommandPreview);
    bindSync('r-env',      'env-select', updateCommandPreview);
  });
}
