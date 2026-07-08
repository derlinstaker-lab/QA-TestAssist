-- schema.sql: Customer table DDL for qa_dashboard
-- Run against the qa_dashboard database. Idempotent (safe to re-run).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS customers (
    id                  SERIAL       PRIMARY KEY,
    unique_id           TEXT         UNIQUE NOT NULL,
    customer_name       TEXT         NOT NULL,
    launched            BOOLEAN,
    status              TEXT         CHECK (status IN ('Implementation', 'Support', 'Active SOW')),
    release_name        TEXT,
    release             TEXT,
    last_major_update   TEXT,
    last_minor_update   TEXT,
    ol_poc              TEXT,
    csm                 TEXT,
    pm                  TEXT,
    implementation      TEXT,
    expert_services     TEXT,
    partner_contact     TEXT,
    authorized_regions  TEXT,
    access_notes        TEXT,
    sla_type            TEXT,
    weekend_upgrades    BOOLEAN,
    maintenance_window  TEXT,
    emergency_window    TEXT,
    timezone            TEXT,
    modules             TEXT,
    prod_url            TEXT,
    test_url            TEXT,
    launch_date         TEXT,
    csat_score          NUMERIC(4,2),
    kb_article          TEXT,
    uat_url             TEXT,
    created_at          TIMESTAMPTZ  DEFAULT NOW(),
    updated_at          TIMESTAMPTZ  DEFAULT NOW()
);

ALTER TABLE customers ADD COLUMN IF NOT EXISTS kb_article TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS uat_url TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS int_url TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS ppe_url TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS stage_url TEXT;

CREATE INDEX IF NOT EXISTS idx_customers_status        ON customers (status);
CREATE INDEX IF NOT EXISTS idx_customers_launched      ON customers (launched);
CREATE INDEX IF NOT EXISTS idx_customers_release_name  ON customers (release_name);
CREATE INDEX IF NOT EXISTS idx_customers_name_trgm     ON customers USING gin (customer_name gin_trgm_ops);

-- customer_name must be unique to be an FK target for the tables below.
-- Verified no existing duplicates before adding this (see plan Task 2).
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_customer_name_unique
  ON customers (customer_name);

-- Link recent-tickets cache (rolling 14-day window) — populated by a
-- manual sync procedure, see docs/link-data-sync-runbook.md. The running
-- app only ever reads this table; it never calls Link directly.
CREATE TABLE IF NOT EXISTS link_customer_tasks (
    id              SERIAL PRIMARY KEY,
    customer_name   TEXT NOT NULL REFERENCES customers(customer_name) ON DELETE CASCADE,
    task_path       TEXT,
    task_type       TEXT,
    status          TEXT,
    total_minutes   INTEGER,
    teams           TEXT,
    synced_at       TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_link_customer_tasks_customer_name
  ON link_customer_tasks (customer_name);

-- Tracks when each customer's Link data was last synced, independent of
-- whether any tasks were found (a customer can be synced with zero tasks).
CREATE TABLE IF NOT EXISTS link_sync_status (
    customer_name TEXT PRIMARY KEY REFERENCES customers(customer_name) ON DELETE CASCADE,
    synced_at     TIMESTAMPTZ NOT NULL
);

-- Raw per-customer Link account/profile data (uncurated) — captured via
-- GetTaskDetail's parent_task on any known ticket for that customer. See
-- docs/superpowers/specs/2026-07-08-link-customer-fields-revival-design.md.
CREATE TABLE IF NOT EXISTS link_customer_fields (
    customer_name TEXT PRIMARY KEY REFERENCES customers(customer_name) ON DELETE CASCADE,
    data          JSONB NOT NULL,
    synced_at     TIMESTAMPTZ NOT NULL
);

-- Postman collections cache — synced from Postman API on server start
CREATE TABLE IF NOT EXISTS postman_collections (
    uid         TEXT        PRIMARY KEY,
    id          TEXT,
    name        TEXT        NOT NULL,
    owner       TEXT,
    is_public   BOOLEAN,
    fork        JSONB,
    created_at  TIMESTAMPTZ,
    updated_at  TIMESTAMPTZ,
    synced_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_postman_collections_name ON postman_collections (name);

-- Postman environments cache — synced from Postman API on server start
CREATE TABLE IF NOT EXISTS postman_environments (
    uid         TEXT        PRIMARY KEY,
    id          TEXT,
    name        TEXT        NOT NULL,
    owner       TEXT,
    is_public   BOOLEAN,
    created_at  TIMESTAMPTZ,
    updated_at  TIMESTAMPTZ,
    synced_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_postman_environments_name ON postman_environments (name);
