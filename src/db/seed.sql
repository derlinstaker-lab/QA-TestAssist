-- seed.sql: Import customers from CustomerDataExport.csv into the customers table.
-- Idempotent — uses ON CONFLICT DO UPDATE so re-running refreshes existing rows.
-- Requires schema.sql to have been run first.

CREATE TEMP TABLE _customers_raw (
    customer_name       TEXT,
    launched            TEXT,
    status              TEXT,
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
    weekend_upgrades    TEXT,
    maintenance_window  TEXT,
    emergency_window    TEXT,
    timezone            TEXT,
    modules             TEXT,
    prod_url            TEXT,
    test_url            TEXT,
    launch_date         TEXT,
    csat_score          TEXT,
    unique_id           TEXT
);

\COPY _customers_raw FROM '/Users/derlin.staker/QA-Automation/qa-dashboard-modular/src/data/CustomerDataExport.csv' WITH (FORMAT CSV, HEADER TRUE, ENCODING 'UTF8');

INSERT INTO customers (
    unique_id, customer_name, launched, status,
    release_name, release,
    last_major_update, last_minor_update,
    ol_poc, csm, pm, implementation, expert_services, partner_contact,
    authorized_regions, access_notes,
    sla_type, weekend_upgrades,
    maintenance_window, emergency_window,
    timezone, modules, prod_url, test_url,
    launch_date, csat_score
)
SELECT
    NULLIF(TRIM(unique_id),           ''),
    TRIM(customer_name),
    CASE LOWER(TRIM(launched))
        WHEN 'yes' THEN TRUE
        WHEN 'no'  THEN FALSE
        ELSE NULL
    END,
    NULLIF(TRIM(status),              ''),
    NULLIF(TRIM(release_name),        ''),
    NULLIF(TRIM(release),             ''),
    NULLIF(TRIM(last_major_update),   ''),
    NULLIF(TRIM(last_minor_update),   ''),
    NULLIF(TRIM(ol_poc),              ''),
    NULLIF(TRIM(csm),                 ''),
    NULLIF(TRIM(pm),                  ''),
    NULLIF(TRIM(implementation),      ''),
    NULLIF(TRIM(expert_services),     ''),
    NULLIF(TRIM(partner_contact),     ''),
    NULLIF(TRIM(authorized_regions),  ''),
    NULLIF(TRIM(access_notes),        ''),
    NULLIF(TRIM(sla_type),            ''),
    CASE LOWER(TRIM(weekend_upgrades))
        WHEN 'yes' THEN TRUE
        WHEN 'no'  THEN FALSE
        ELSE NULL
    END,
    NULLIF(TRIM(maintenance_window),  ''),
    NULLIF(TRIM(emergency_window),    ''),
    NULLIF(REGEXP_REPLACE(TRIM(timezone), '\t+', ' ', 'g'), ''),
    NULLIF(TRIM(modules),             ''),
    NULLIF(TRIM(prod_url),            ''),
    NULLIF(TRIM(test_url),            ''),
    NULLIF(TRIM(launch_date),         ''),
    CASE
        WHEN TRIM(csat_score) ~ '^\d+(\.\d+)?$' THEN TRIM(csat_score)::NUMERIC
        ELSE NULL
    END
FROM _customers_raw
WHERE TRIM(COALESCE(unique_id, '')) != ''
ON CONFLICT (unique_id) DO UPDATE SET
    customer_name      = EXCLUDED.customer_name,
    launched           = EXCLUDED.launched,
    status             = EXCLUDED.status,
    release_name       = EXCLUDED.release_name,
    release            = EXCLUDED.release,
    last_major_update  = EXCLUDED.last_major_update,
    last_minor_update  = EXCLUDED.last_minor_update,
    ol_poc             = EXCLUDED.ol_poc,
    csm                = EXCLUDED.csm,
    pm                 = EXCLUDED.pm,
    implementation     = EXCLUDED.implementation,
    expert_services    = EXCLUDED.expert_services,
    partner_contact    = EXCLUDED.partner_contact,
    authorized_regions = EXCLUDED.authorized_regions,
    access_notes       = EXCLUDED.access_notes,
    sla_type           = EXCLUDED.sla_type,
    weekend_upgrades   = EXCLUDED.weekend_upgrades,
    maintenance_window = EXCLUDED.maintenance_window,
    emergency_window   = EXCLUDED.emergency_window,
    timezone           = EXCLUDED.timezone,
    modules            = EXCLUDED.modules,
    prod_url           = EXCLUDED.prod_url,
    test_url           = EXCLUDED.test_url,
    launch_date        = EXCLUDED.launch_date,
    csat_score         = EXCLUDED.csat_score,
    updated_at         = NOW();
