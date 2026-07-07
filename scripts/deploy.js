#!/usr/bin/env node
/**
 * deploy.js — QA Test Assist deployment script
 *
 * Supported targets:
 *   --target s3          Upload dist/ to AWS S3 + optionally invalidate CloudFront
 *   --target gh-pages    Push dist/ to the gh-pages branch via git
 *   --target netlify     Deploy via Netlify CLI
 *   --target local       Just verify dist/ is ready (default / dry-run)
 *
 * Configuration is read from qa-dashboard.config.json and environment variables.
 *
 * Usage:
 *   node scripts/deploy.js                    # dry-run / local verify
 *   node scripts/deploy.js --target s3
 *   node scripts/deploy.js --target gh-pages
 *   node scripts/deploy.js --target netlify
 *   node scripts/deploy.js --target s3 --dry-run
 */

const fs      = require('fs');
const path    = require('path');
const { execSync, spawnSync } = require('child_process');

const args    = process.argv.slice(2);
const TARGET  = argValue(args, '--target') || 'local';
const DRY_RUN = args.includes('--dry-run');
const ROOT    = path.resolve(__dirname, '..');
const DIST    = path.join(ROOT, 'dist');
const CONFIG  = loadConfig();

// ─────────────────────────────────────────────────────────
async function main() {
  console.log('\n  \x1b[36m◆ QA Test Assist — Deploy\x1b[0m\n');
  log('info', `Target  : ${TARGET}${DRY_RUN ? '  [DRY RUN]' : ''}`);

  // Pre-flight checks
  if (!fs.existsSync(DIST)) {
    log('error', 'dist/ not found — run: npm run build first');
    process.exit(1);
  }

  const manifest = loadManifest();
  if (manifest) {
    log('info', `Version : ${manifest.version}  built ${manifest.buildTime}`);
    log('info', `Env     : ${manifest.env}  commit ${manifest.commit}`);
  }

  const distFiles = walkDir(DIST);
  log('info', `Files   : ${distFiles.length} file(s) in dist/`);
  console.log('');

  switch (TARGET) {
    case 's3':       await deployS3();       break;
    case 'gh-pages': await deployGhPages();  break;
    case 'netlify':  await deployNetlify();  break;
    case 'local':    deployLocal();          break;
    default:
      log('error', `Unknown target: ${TARGET}`);
      log('info',  'Valid targets: s3, gh-pages, netlify, local');
      process.exit(1);
  }
}

// ─────────────────────────────────────────────────────────
// Target: S3
// ─────────────────────────────────────────────────────────
async function deployS3() {
  const bucket     = process.env.AWS_S3_BUCKET     || CONFIG.deploy?.s3?.bucket;
  const region     = process.env.AWS_REGION         || CONFIG.deploy?.s3?.region     || 'us-east-1';
  const cfDistId   = process.env.CF_DISTRIBUTION_ID || CONFIG.deploy?.s3?.cloudfrontDistributionId;
  const prefix     = CONFIG.deploy?.s3?.prefix || '';

  if (!bucket) {
    log('error', 'AWS_S3_BUCKET not set. Add it to your environment or qa-dashboard.config.json');
    log('info',  'Example: export AWS_S3_BUCKET=my-qa-dashboard-bucket');
    process.exit(1);
  }

  assertCLI('aws', 'Install AWS CLI: https://aws.amazon.com/cli/');

  const s3Path = `s3://${bucket}/${prefix}`.replace(/\/$/, '');
  log('info', `Uploading dist/ → ${s3Path}`);

  const syncCmd = [
    'aws s3 sync', DIST, s3Path,
    '--region', region,
    '--delete',
    '--cache-control "public, max-age=31536000" --exclude "*.html"',
    '--metadata-directive REPLACE',
  ].join(' ');

  const htmlCmd = [
    'aws s3 sync', DIST, s3Path,
    '--region', region,
    '--exclude "*" --include "*.html"',
    '--cache-control "no-cache, no-store, must-revalidate"',
    '--content-type "text/html; charset=utf-8"',
    '--metadata-directive REPLACE',
  ].join(' ');

  if (!DRY_RUN) {
    run(syncCmd);
    run(htmlCmd);
    log('ok', 'Files uploaded to S3');
  } else {
    log('info', `[dry-run] Would run: ${syncCmd}`);
    log('info', `[dry-run] Would run: ${htmlCmd}`);
  }

  // CloudFront invalidation
  if (cfDistId) {
    log('info', `Invalidating CloudFront distribution: ${cfDistId}`);
    const cfCmd = `aws cloudfront create-invalidation --distribution-id ${cfDistId} --paths "/*"`;
    if (!DRY_RUN) {
      run(cfCmd);
      log('ok', 'CloudFront cache invalidated');
    } else {
      log('info', `[dry-run] Would run: ${cfCmd}`);
    }
  }

  const websiteUrl = CONFIG.deploy?.s3?.websiteUrl ||
    `http://${bucket}.s3-website-${region}.amazonaws.com`;
  log('success', `Deployed → ${websiteUrl}`);
}

// ─────────────────────────────────────────────────────────
// Target: GitHub Pages
// ─────────────────────────────────────────────────────────
async function deployGhPages() {
  assertCLI('git', 'Install git: https://git-scm.com');

  const branch    = CONFIG.deploy?.ghPages?.branch || 'gh-pages';
  const remote    = CONFIG.deploy?.ghPages?.remote || 'origin';
  const nojekyll  = CONFIG.deploy?.ghPages?.nojekyll !== false;

  log('info', `Deploying dist/ → branch: ${branch} (remote: ${remote})`);

  if (nojekyll) {
    fs.writeFileSync(path.join(DIST, '.nojekyll'), '');
    log('ok', '.nojekyll created');
  }

  const manifest = loadManifest();
  const commitMsg = manifest
    ? `deploy: v${manifest.version} (${manifest.commit}) [${manifest.env}]`
    : `deploy: ${new Date().toISOString()}`;

  if (!DRY_RUN) {
    const tmpBranch = `gh-pages-deploy-${Date.now()}`;
    const cmds = [
      `git -C "${DIST}" init -q`,
      `git -C "${DIST}" checkout -b ${tmpBranch}`,
      `git -C "${DIST}" add -A`,
      `git -C "${DIST}" -c user.email="deploy@qa-test-assist" -c user.name="QA Deploy" commit -m "${commitMsg}" -q`,
      `git push -f "${ROOT}" ${tmpBranch}:${branch}`,
    ];
    for (const cmd of cmds) run(cmd);

    // Clean up temp git in dist
    const gitDir = path.join(DIST, '.git');
    if (fs.existsSync(gitDir)) fs.rmSync(gitDir, { recursive: true });

    log('ok', `Pushed to branch: ${branch}`);
  } else {
    log('info', `[dry-run] Would push dist/ to ${remote}/${branch}`);
    log('info', `[dry-run] Commit message: "${commitMsg}"`);
  }

  const repoUrl = getGitRemoteUrl(remote);
  if (repoUrl) {
    const ghUser = repoUrl.match(/github\.com[:/]([^/]+)/)?.[1];
    const ghRepo = repoUrl.match(/\/([^/]+?)(?:\.git)?$/)?.[1];
    if (ghUser && ghRepo) {
      log('success', `Deployed → https://${ghUser}.github.io/${ghRepo}/`);
    }
  } else {
    log('success', `Deployed → ${branch} branch`);
  }
}

// ─────────────────────────────────────────────────────────
// Target: Netlify
// ─────────────────────────────────────────────────────────
async function deployNetlify() {
  assertCLI('netlify', 'Install Netlify CLI: npm install -g netlify-cli');

  const siteId = process.env.NETLIFY_SITE_ID || CONFIG.deploy?.netlify?.siteId;
  const prod   = CONFIG.deploy?.netlify?.production !== false;

  const netlifyCmd = [
    'netlify deploy',
    '--dir', DIST,
    prod ? '--prod' : '',
    siteId ? `--site ${siteId}` : '',
    '--json',
  ].filter(Boolean).join(' ');

  log('info', `Running: ${netlifyCmd}`);

  if (!DRY_RUN) {
    const result = spawnSync('netlify', [
      'deploy', '--dir', DIST,
      ...(prod ? ['--prod'] : []),
      ...(siteId ? ['--site', siteId] : []),
    ], { stdio: 'inherit', cwd: ROOT });

    if (result.status !== 0) {
      log('error', 'Netlify deploy failed');
      process.exit(1);
    }
    log('success', 'Deployed to Netlify');
  } else {
    log('info', `[dry-run] Would run: ${netlifyCmd}`);
  }
}

// ─────────────────────────────────────────────────────────
// Target: Local verify
// ─────────────────────────────────────────────────────────
function deployLocal() {
  const files = walkDir(DIST);
  const totalBytes = files.reduce((acc, f) => acc + fs.statSync(f).size, 0);

  console.log('  \x1b[2mFiles in dist/:\x1b[0m');
  files.forEach(f => {
    const rel   = path.relative(DIST, f);
    const size  = fmt(fs.statSync(f).size);
    console.log(`    \x1b[2m${rel.padEnd(30)}\x1b[0m  ${size}`);
  });
  console.log('');
  log('ok', `Total: ${files.length} files, ${fmt(totalBytes)}`);
  log('success', 'dist/ is ready to deploy');
  log('info', 'Run with --target <s3|gh-pages|netlify> to deploy');
}

// ─────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────
function loadConfig() {
  const cfgPath = path.join(ROOT, 'qa-dashboard.config.json');
  try { return JSON.parse(fs.readFileSync(cfgPath, 'utf8')); } catch { return {}; }
}

function loadManifest() {
  const mp = path.join(DIST, 'build-manifest.json');
  try { return JSON.parse(fs.readFileSync(mp, 'utf8')); } catch { return null; }
}

function assertCLI(cli, hint) {
  try { execSync(`${cli} --version`, { stdio: 'ignore' }); }
  catch {
    log('error', `'${cli}' CLI not found. ${hint}`);
    process.exit(1);
  }
}

function run(cmd) {
  log('exec', cmd);
  try {
    execSync(cmd, { stdio: 'inherit', cwd: ROOT });
  } catch (e) {
    log('error', `Command failed: ${cmd}`);
    process.exit(1);
  }
}

function walkDir(dir) {
  if (!fs.existsSync(dir)) return [];
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...walkDir(full));
    else results.push(full);
  }
  return results;
}

function getGitRemoteUrl(remote) {
  try { return execSync(`git remote get-url ${remote}`, { stdio: ['ignore','pipe','ignore'] }).toString().trim(); }
  catch { return ''; }
}

function fmt(bytes) {
  return bytes < 1024 ? `${bytes}B`
       : bytes < 1024*1024 ? `${(bytes/1024).toFixed(1)}KB`
       : `${(bytes/(1024*1024)).toFixed(2)}MB`;
}

function argValue(args, flag) {
  const i = args.indexOf(flag);
  return i !== -1 && args[i+1] ? args[i+1] : null;
}

function log(level, msg) {
  const prefix = {
    info   : '\x1b[36mINFO \x1b[0m',
    ok     : '\x1b[32m  OK \x1b[0m',
    success: '\x1b[32m✔    \x1b[0m',
    warn   : '\x1b[33mWARN \x1b[0m',
    error  : '\x1b[31mERR  \x1b[0m',
    exec   : '\x1b[2m RUN \x1b[0m',
  }[level] || '     ';
  const ts = new Date().toTimeString().slice(0,8);
  console.log(`\x1b[2m[${ts}]\x1b[0m ${prefix} ${msg}`);
}

// ─────────────────────────────────────────────────────────
main().catch(e => { log('error', e.message); process.exit(1); });
