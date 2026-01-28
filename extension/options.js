'use strict';

const ext = typeof browser !== 'undefined' ? browser : chrome;

const BLOCKLIST_KEY = 'blockedUsers';
const DISPLAY_BLOCKLIST_KEY = 'blockedDisplayNames';
const AUTO_MAP_KEY = 'autoMapUsernames';
const storage = ext.storage && ext.storage.sync ? ext.storage.sync : ext.storage.local;

const textarea = document.getElementById('blockedUsers');
const displayTextarea = document.getElementById('blockedDisplayNames');
const autoMapCheckbox = document.getElementById('autoMapUsernames');
const saveButton = document.getElementById('save');
const status = document.getElementById('status');

function normalizeUsername(value) {
  if (!value) return '';
  return value.trim().replace(/^@+/, '').toLowerCase();
}

function normalizeDisplayName(value) {
  if (!value) return '';
  return value.trim().toLowerCase();
}

function loadBlocklist() {
  const maybePromise = storage.get([BLOCKLIST_KEY, DISPLAY_BLOCKLIST_KEY, AUTO_MAP_KEY], (result) => {
    if (result) {
      const list = Array.isArray(result[BLOCKLIST_KEY]) ? result[BLOCKLIST_KEY] : [];
      const displayList = Array.isArray(result[DISPLAY_BLOCKLIST_KEY]) ? result[DISPLAY_BLOCKLIST_KEY] : [];
      const autoMap = result[AUTO_MAP_KEY] === undefined ? true : Boolean(result[AUTO_MAP_KEY]);
      textarea.value = list.join('\n');
      displayTextarea.value = displayList.join('\n');
      autoMapCheckbox.checked = autoMap;
    }
  });
  if (maybePromise && typeof maybePromise.then === 'function') {
    maybePromise.then((result) => {
      const list = Array.isArray(result[BLOCKLIST_KEY]) ? result[BLOCKLIST_KEY] : [];
      const displayList = Array.isArray(result[DISPLAY_BLOCKLIST_KEY]) ? result[DISPLAY_BLOCKLIST_KEY] : [];
      const autoMap = result[AUTO_MAP_KEY] === undefined ? true : Boolean(result[AUTO_MAP_KEY]);
      textarea.value = list.join('\n');
      displayTextarea.value = displayList.join('\n');
      autoMapCheckbox.checked = autoMap;
    });
  }
}

function saveBlocklist() {
  const lines = textarea.value.split(/\r?\n/);
  const displayLines = displayTextarea.value.split(/\r?\n/);
  const normalized = Array.from(
    new Set(lines.map(normalizeUsername).filter(Boolean))
  ).sort();
  const normalizedDisplay = Array.from(
    new Set(displayLines.map(normalizeDisplayName).filter(Boolean))
  ).sort();
  const autoMap = Boolean(autoMapCheckbox.checked);
  const maybePromise = storage.set(
    { [BLOCKLIST_KEY]: normalized, [DISPLAY_BLOCKLIST_KEY]: normalizedDisplay, [AUTO_MAP_KEY]: autoMap },
    () => {
      status.textContent = 'Saved.';
      setTimeout(() => {
        status.textContent = '';
      }, 1500);
    }
  );
  if (maybePromise && typeof maybePromise.then === 'function') {
    maybePromise.then(() => {
      status.textContent = 'Saved.';
      setTimeout(() => {
        status.textContent = '';
      }, 1500);
    });
  }
}

saveButton.addEventListener('click', saveBlocklist);

loadBlocklist();
