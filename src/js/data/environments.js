/**
 * data/environments.js - Environment enum and select options.
 *
 * Add or rename environments here; the header and runner selects render from
 * this list during app bootstrap.
 */

export const ENVIRONMENTS = Object.freeze({
  TEST:  'TEST',
  UAT:   'UAT',
  PROD:  'PROD',
  INT:   'INT',
  PPE:   'PPE',
  STAGE: 'STAGE',
});

export const DEFAULT_ENVIRONMENT = ENVIRONMENTS.TEST;

export const ENVIRONMENT_OPTIONS = Object.freeze(
  Object.values(ENVIRONMENTS).map(value => Object.freeze({
    value,
    label: value,
  }))
);
