#!/usr/bin/env node
/**
 * lint.js — Basic static analysis for QA Test Assist source files
 *
 * Checks:
 *   - Well-formed HTML structure (doctype, head, body, title)
 *   - <script> and <style> tag balance
 *   - No console.log left in production JS (warn)
 *   - No TODO/FIXME comments (warn)
 *   - File size within thresholds
 *   - Inline images encoded as base64 (warn, prefer external)
 */

const fs   = require('fs');
const path = require('path');

const SRC     = path.resolve(__dirname, '..', 'src', 'index.html');
const MAX_KB  = 1024; // warn if src > 1MB
let   errors  = 0;
let   warnings= 0;

console.log('\n  \x1b[36m◆ QA Test Assist — Lint\x1b[0m\n');

if (!fs.existsSync(SRC)) {
  fail(`Source file not found: ${SRC}`);
  process.exit(1);
}

const html = fs.readFileSync(SRC, 'utf8');
const lines = html.split('\n');
const sizeKb = (Buffer.byteLength(html) / 1024).toFixed(1);

info(`Linting: ${path.relative(process.cwd(), SRC)}  (${sizeKb}KB)`);
console.log('');

// ── Structural checks ────────────────────────────────
check('DOCTYPE declaration present',
  /<!DOCTYPE\s+html/i.test(html));

check('<html> tag present',
  /<html/i.test(html));

check('<head> tag present',
  /<head[\s>]/i.test(html));

check('<title> tag present',
  /<title>/i.test(html));

check('<body> tag present',
  /<body[\s>]/i.test(html));

check('charset meta tag present',
  /<meta\s+charset/i.test(html));

check('viewport meta tag present',
  /<meta\s+name="viewport"/i.test(html));

// ── Tag balance ──────────────────────────────────────
const scriptOpen  = (html.match(/<script[\s>]/gi)  || []).length;
const scriptClose = (html.match(/<\/script>/gi)    || []).length;
check(`<script> tags balanced (${scriptOpen} open / ${scriptClose} close)`,
  scriptOpen === scriptClose);

const styleOpen  = (html.match(/<style[\s>]/gi) || []).length;
const styleClose = (html.match(/<\/style>/gi)   || []).length;
check(`<style> tags balanced (${styleOpen} open / ${styleClose} close)`,
  styleOpen === styleClose);

// ── Content checks ───────────────────────────────────
const consoleLogs = findLines(lines, /console\.log\s*\(/);
if (consoleLogs.length) {
  warn(`console.log() found on ${consoleLogs.length} line(s): ${consoleLogs.map(l=>`L${l}`).join(', ')}`);
}

const todos = findLines(lines, /\/\/\s*(TODO|FIXME|HACK|XXX)/i);
if (todos.length) {
  warn(`TODO/FIXME comments on line(s): ${todos.map(l=>`L${l}`).join(', ')}`);
}

const b64images = findLines(lines, /data:image\//);
if (b64images.length) {
  warn(`Base64-encoded image(s) on line(s): ${b64images.map(l=>`L${l}`).join(', ')} — consider external assets`);
}

// ── Size check ───────────────────────────────────────
if (parseFloat(sizeKb) > MAX_KB) {
  warn(`Source file is ${sizeKb}KB (threshold: ${MAX_KB}KB) — consider splitting`);
} else {
  ok(`File size OK (${sizeKb}KB)`);
}

// ── External resource check ──────────────────────────
const extLinks = (html.match(/https?:\/\/[^\s"'>]+/g) || []);
const uniqueHosts = [...new Set(extLinks.map(u => {
  try { return new URL(u).hostname; } catch { return u; }
}))];
if (uniqueHosts.length) {
  info(`External hosts referenced: ${uniqueHosts.join(', ')}`);
}

// ── Summary ──────────────────────────────────────────
console.log('');
if (errors === 0 && warnings === 0) {
  console.log('  \x1b[32m✔ No issues found\x1b[0m\n');
} else {
  if (errors > 0)   console.log(`  \x1b[31m✖ ${errors} error(s)\x1b[0m`);
  if (warnings > 0) console.log(`  \x1b[33m⚠ ${warnings} warning(s)\x1b[0m`);
  console.log('');
}

process.exit(errors > 0 ? 1 : 0);

// ── Helpers ──────────────────────────────────────────
function check(msg, ok_) {
  if (ok_) { ok(msg); } else { fail(msg); }
}

function ok(msg) {
  console.log(`  \x1b[32m✔\x1b[0m  ${msg}`);
}

function fail(msg) {
  console.log(`  \x1b[31m✖\x1b[0m  ${msg}`);
  errors++;
}

function warn(msg) {
  console.log(`  \x1b[33m⚠\x1b[0m  ${msg}`);
  warnings++;
}

function info(msg) {
  console.log(`  \x1b[2m·\x1b[0m  ${msg}`);
}

function findLines(lines, re) {
  return lines.reduce((acc, l, i) => {
    if (re.test(l)) acc.push(i + 1);
    return acc;
  }, []);
}
