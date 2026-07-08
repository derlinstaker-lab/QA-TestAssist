#!/usr/bin/env node
/**
 * write-link-data.js — upserts one customer's synced Link data into Postgres.
 *
 * Usage: echo '<json>' | node scripts/write-link-data.js
 * Input JSON shape: {
 *   "customerName": string,
 *   "fields"?: object,  // raw GetTaskDetail parent_task object; omit if unavailable
 *   "tasks": Array<{taskPath, taskType, status, totalMinutes, teams}>
 * }
 *
 * "fields" is stored verbatim as JSONB — no curation. See
 * docs/superpowers/specs/2026-07-08-link-customer-fields-revival-design.md.
 */
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'qa-dashboard.config.json'), 'utf8'));
  } catch {
    return {};
  }
}

async function main() {
  const raw = fs.readFileSync(0, 'utf8');
  let input;
  try {
    input = JSON.parse(raw);
  } catch (e) {
    console.error(`Invalid JSON on stdin: ${e.message}`);
    process.exit(1);
  }

  const { customerName, fields, tasks } = input;
  if (!customerName || typeof customerName !== 'string') {
    console.error('customerName is required');
    process.exit(1);
  }

  const config = loadConfig();
  if (!config.database) {
    console.error('No database config found in qa-dashboard.config.json');
    process.exit(1);
  }
  const pool = new Pool(config.database);

  try {
    if (fields && typeof fields === 'object') {
      await pool.query(
        `INSERT INTO link_customer_fields (customer_name, data, synced_at) VALUES ($1, $2, NOW())
         ON CONFLICT (customer_name) DO UPDATE SET data = EXCLUDED.data, synced_at = NOW()`,
        [customerName, JSON.stringify(fields)]
      );
    }

    await pool.query('DELETE FROM link_customer_tasks WHERE customer_name = $1', [customerName]);
    for (const t of tasks || []) {
      await pool.query(
        `INSERT INTO link_customer_tasks (customer_name, task_path, task_type, status, total_minutes, teams, synced_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [customerName, t.taskPath ?? null, t.taskType ?? null, t.status ?? null, t.totalMinutes ?? null, t.teams ?? null]
      );
    }

    await pool.query(
      `INSERT INTO link_sync_status (customer_name, synced_at) VALUES ($1, NOW())
       ON CONFLICT (customer_name) DO UPDATE SET synced_at = NOW()`,
      [customerName]
    );

    console.log(`Synced ${customerName}: fields=${fields ? 'yes' : 'no'}, tasks=${(tasks || []).length}`);
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error(`write-link-data.js failed: ${err.message}`);
  process.exit(1);
});
