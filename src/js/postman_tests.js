import { initClock }              from './modules/clock.js';
import { initRunner }             from './modules/runner.js';
import { initHeaderSync }         from './modules/headerSync.js';
import { initEnvironmentSelects } from './modules/environmentSelects.js';
import { initClientSelects }      from './modules/customerSelect.js';

document.addEventListener('DOMContentLoaded', () => {
  initEnvironmentSelects();
  initClientSelects();
  initClock();
  initHeaderSync();
  initRunner();
});
