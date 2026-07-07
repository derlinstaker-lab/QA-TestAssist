/**
 * commandBuilder.js — Builds the Postman CLI command string from
 * the current form state and renders it into #cmd-preview.
 *
 * Purely presentational — no side effects beyond DOM updates.
 */

const FIELD_IDS = ['r-collection', 'r-folder', 'r-postman-env', 'r-envvars'];

/** @returns {{ col:string, env:string, folder:string, iter:number, delay:number, vars:string }} */
function readFields() {
  const $ = id => document.getElementById(id);
  return {
    col   : $('r-collection')?.value.trim()    || '&lt;collection-id&gt;',
    folder: $('r-folder')?.value.trim()        || '',
    env   : $('r-postman-env')?.value.trim()   || '',
    vars  : $('r-envvars')?.value.trim()       || '',
  };
}

/**
 * Build an array of highlighted HTML lines representing the CLI command.
 * @returns {string[]}
 */
function buildLines() {
  const { col, folder, env, vars } = readFields();

  const lines = [
    `<span class="cmd-bin">postman</span> collection run <span class="cmd-val">${col}</span>`,
  ];

  if (folder) {
    lines.push(`  <span class="cmd-flag">--folder</span> <span class="cmd-val">"${folder}"</span>`);
  }
  if (env) {
    lines.push(`  <span class="cmd-flag">-e</span> <span class="cmd-val">"${env}"</span>`);
  }
  vars.split('\n').forEach(line => {
    const eqIdx = line.indexOf('=');
    if (eqIdx > 0) {
      const k = line.slice(0, eqIdx).trim();
      const v = line.slice(eqIdx + 1).trim();
      if (k) lines.push(`  <span class="cmd-flag">--env-var</span> <span class="cmd-val">"${k}=${v}"</span>`);
    }
  });

  lines.push(`  <span class="cmd-flag">--reporters</span> <span class="cmd-val">cli,junit</span>`);
  return lines;
}

/** Re-render the command preview element. */
export function updateCommandPreview() {
  const el = document.getElementById('cmd-preview');
  if (el) el.innerHTML = buildLines().join(' \\\n');
}

/** Copy the current command text to the clipboard. */
export function copyCommand() {
  const el = document.getElementById('cmd-preview');
  if (!el) return;

  navigator.clipboard.writeText(el.innerText).then(() => {
    const btn = document.getElementById('copy-cmd-btn');
    if (!btn) return;
    const original = btn.textContent;
    btn.textContent = 'Copied!';
    btn.style.color = 'var(--success)';
    btn.style.borderColor = 'var(--success)';
    setTimeout(() => {
      btn.textContent = original;
      btn.style.color = '';
      btn.style.borderColor = '';
    }, 1800);
  });
}

/** Attach input listeners so the preview stays live. */
export function initCommandBuilder() {
  FIELD_IDS.forEach(id => {
    const el = document.getElementById(id);
    el?.addEventListener('input',  updateCommandPreview);
    el?.addEventListener('change', updateCommandPreview);
  });

  document.getElementById('copy-cmd-btn')
    ?.addEventListener('click', copyCommand);

  updateCommandPreview(); // initial render
}
