/**
 * main.js — Application entry point
 *
 * Imports and initialises every module. Nothing lives here except
 * bootstrap calls — all logic belongs in the relevant module.
 */

import { initClock }              from './modules/clock.js';
import { initStats }              from './modules/stats.js';
import { initRecentRuns }         from './modules/recentRuns.js';
import { initActivity }           from './modules/activity.js';
import { initHeaderSync }         from './modules/headerSync.js';
import { initEnvironmentSelects } from './modules/environmentSelects.js';
import { initClientSelects }      from './modules/customerSelect.js';

document.addEventListener('DOMContentLoaded', () => {
  initEnvironmentSelects();
  initClientSelects();
  initClock();
  initStats();
  initRecentRuns();
  initActivity();
  initHeaderSync();
});
