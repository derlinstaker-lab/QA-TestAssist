#!/usr/bin/env node
/**
 * Starts the local dev server unless it is already responding.
 * Used by VS Code so F5 works with or without a running terminal server.
 */

const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number.parseInt(process.env.PORT || '3000', 10);
const URL = `http://localhost:${PORT}`;

checkServer(URL).then((isRunning) => {
  if (isRunning) {
    console.log('\n  QA Test Assist - Dev Server\n');
    console.log(`  Local:   ${URL} (already running)\n`);
    return;
  }

  const child = spawn(
    process.execPath,
    [path.join(__dirname, 'dev-server.js'), '--port', String(PORT)],
    { cwd: ROOT, stdio: 'inherit' }
  );

  process.on('SIGINT', () => child.kill('SIGINT'));
  process.on('SIGTERM', () => child.kill('SIGTERM'));
  child.on('exit', (code) => process.exit(code ?? 0));
});

function checkServer(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 500);
    });

    req.on('error', () => resolve(false));
    req.setTimeout(500, () => {
      req.destroy();
      resolve(false);
    });
  });
}
