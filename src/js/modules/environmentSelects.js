/**
 * environmentSelects.js - Populates all environment dropdowns from the
 * environment enum.
 */

import { DEFAULT_ENVIRONMENT, ENVIRONMENT_OPTIONS } from '../data/environments.js';

const ENVIRONMENT_SELECT_IDS = ['env-select', 'r-env'];
const STORAGE_KEY_ENV = 'qa-dashboard:env';

function createOption({ value, label }) {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = label;
  return option;
}

function populateEnvironmentSelect(select) {
  const saved = localStorage.getItem(STORAGE_KEY_ENV);
  const preferredValue = saved || select.value || select.dataset.defaultValue || DEFAULT_ENVIRONMENT;
  const hasPreferredValue = ENVIRONMENT_OPTIONS.some(({ value }) => value === preferredValue);

  select.replaceChildren(...ENVIRONMENT_OPTIONS.map(createOption));
  select.value = hasPreferredValue ? preferredValue : DEFAULT_ENVIRONMENT;
}

export function initEnvironmentSelects() {
  ENVIRONMENT_SELECT_IDS.forEach(id => {
    const select = document.getElementById(id);
    if (select) {
      populateEnvironmentSelect(select);
      select.addEventListener('change', () => {
        localStorage.setItem(STORAGE_KEY_ENV, select.value);
      });
    }
  });
}
