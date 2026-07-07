import { initClock }              from './modules/clock.js';
import { initRecentRuns }         from './modules/recentRuns.js';
import { initActivity }           from './modules/activity.js';
import { initEnvironmentSelects } from './modules/environmentSelects.js';
import { initClientSelects }      from './modules/customerSelect.js';

document.addEventListener('DOMContentLoaded', () => {
  initEnvironmentSelects();
  initClientSelects();
  initClock();
  initRecentRuns();
  initActivity();
});
