#!/usr/bin/env node
/**
 * restart-server.js — Kill any process holding the dev port, then start the dev server.
 *
 * Usage (same flags as dev-server.js):
 *   node scripts/restart-server.js
 *   node scripts/restart-server.js --port 8080
 *   node scripts/restart-server.js --dir dist
 */

const { execSync, spawn } = require('child_process');
const path = require('path');
const fs   = require('fs');

// Resolve port from args or config
const args = process.argv.slice(2);
function argValue(a, flag) {
  const i = a.indexOf(flag);
  return i !== -1 && a[i + 1] ? a[i + 1] : null;
}
function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'qa-dashboard.config.json'), 'utf8'));
  } catch { return {}; }
}

const PORT = argValue(args, '--port') || loadConfig().dev?.port || 3000;

// Kill anything currently holding the port
function freePort(port) {
  try {
    if (process.platform === 'win32') {
      const out = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8', stdio: ['pipe','pipe','ignore'] });
      const pids = [...new Set(out.split('\n')
        .map(l => l.trim().split(/\s+/).pop())
        .filter(p => /^\d+$/.test(p) && p !== '0'))];
      pids.forEach(pid => {
        try { execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' }); } catch {}
      });
    } else {
      execSync(`lsof -ti:${port} | xargs kill -9 2>/dev/null || true`, { shell: true, stdio: 'ignore' });
    }
    console.log(`[restart] freed port ${port}`);
  } catch {
    // port was already free
  }
}

freePort(PORT);

// Brief pause for the OS to release the port, then spawn the server
setTimeout(() => {
  const server = spawn(
    process.execPath,
    [path.join(__dirname, 'dev-server.js'), ...args],
    { stdio: 'inherit' }
  );
  server.on('exit', code => process.exit(code ?? 0));
}, 400);
