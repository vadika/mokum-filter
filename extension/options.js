'use strict';

const BLOCKLIST_KEY = 'blockedUsers';
const DISPLAY_BLOCKLIST_KEY = 'blockedDisplayNames';
const storage = chrome.storage && chrome.storage.sync ? chrome.storage.sync : chrome.storage.local;

const textarea = document.getElementById('blockedUsers');
const displayTextarea = document.getElementById('blockedDisplayNames');
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
  storage.get([BLOCKLIST_KEY, DISPLAY_BLOCKLIST_KEY], (result) => {
    const list = Array.isArray(result[BLOCKLIST_KEY]) ? result[BLOCKLIST_KEY] : [];
    const displayList = Array.isArray(result[DISPLAY_BLOCKLIST_KEY]) ? result[DISPLAY_BLOCKLIST_KEY] : [];
    textarea.value = list.join('\n');
    displayTextarea.value = displayList.join('\n');
  });
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
  storage.set({ [BLOCKLIST_KEY]: normalized, [DISPLAY_BLOCKLIST_KEY]: normalizedDisplay }, () => {
    status.textContent = 'Saved.';
    setTimeout(() => {
      status.textContent = '';
    }, 1500);
  });
}

saveButton.addEventListener('click', saveBlocklist);

loadBlocklist();
