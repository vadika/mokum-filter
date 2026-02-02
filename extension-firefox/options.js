'use strict';

const ext = typeof browser !== 'undefined' ? browser : chrome;

const BLOCKLIST_KEY = 'blockedUsers';
const WHITELIST_KEY = 'whitelistedUsers';
const DISPLAY_BLOCKLIST_KEY = 'blockedDisplayNames';
const AUTO_MAP_KEY = 'autoMapUsernames';
const BLOCK_BOTS_KEY = 'blockBotsByDefault';
const PERSIST_BOTS_KEY = 'persistBotUsers';
const CREATED_AT_FILTER_KEY = 'filterByCreatedAt';
const CREATED_AT_DATE_KEY = 'createdAtCutoff';
const CREATED_AT_PERSIST_KEY = 'persistCreatedAtBlock';
const storage = ext.storage && ext.storage.sync ? ext.storage.sync : ext.storage.local;

const textarea = document.getElementById('blockedUsers');
const whitelistTextarea = document.getElementById('whitelistedUsers');
const displayTextarea = document.getElementById('blockedDisplayNames');
const autoMapCheckbox = document.getElementById('autoMapUsernames');
const blockBotsCheckbox = document.getElementById('blockBots');
const persistBotsCheckbox = document.getElementById('persistBots');
const filterByCreatedAtCheckbox = document.getElementById('filterByCreatedAt');
const createdAtInput = document.getElementById('createdAtDate');
const persistCreatedAtCheckbox = document.getElementById('persistCreatedAt');
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

function normalizeCreatedAtInput(value) {
  const raw = (value || '').trim();
  if (!raw) return '2026-01-01';
  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }
  const usMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (usMatch) {
    const mm = String(usMatch[1]).padStart(2, '0');
    const dd = String(usMatch[2]).padStart(2, '0');
    return `${usMatch[3]}-${mm}-${dd}`;
  }
  return '2026-01-01';
}

function loadBlocklist() {
  const maybePromise = storage.get(
    [
      BLOCKLIST_KEY,
      WHITELIST_KEY,
      DISPLAY_BLOCKLIST_KEY,
      AUTO_MAP_KEY,
      BLOCK_BOTS_KEY,
      PERSIST_BOTS_KEY,
      CREATED_AT_FILTER_KEY,
      CREATED_AT_DATE_KEY,
      CREATED_AT_PERSIST_KEY
    ],
    (result) => {
    if (result) {
      const list = Array.isArray(result[BLOCKLIST_KEY]) ? result[BLOCKLIST_KEY] : [];
      const whitelist = Array.isArray(result[WHITELIST_KEY]) ? result[WHITELIST_KEY] : [];
      const displayList = Array.isArray(result[DISPLAY_BLOCKLIST_KEY]) ? result[DISPLAY_BLOCKLIST_KEY] : [];
      const autoMap = result[AUTO_MAP_KEY] === undefined ? true : Boolean(result[AUTO_MAP_KEY]);
      const blockBots = result[BLOCK_BOTS_KEY] === undefined ? true : Boolean(result[BLOCK_BOTS_KEY]);
      const persistBots = result[PERSIST_BOTS_KEY] === undefined ? false : Boolean(result[PERSIST_BOTS_KEY]);
      const createdAtEnabled =
        result[CREATED_AT_FILTER_KEY] === undefined ? true : Boolean(result[CREATED_AT_FILTER_KEY]);
      const createdAtDate = normalizeCreatedAtInput(result[CREATED_AT_DATE_KEY]);
      const persistCreatedAt =
        result[CREATED_AT_PERSIST_KEY] === undefined ? false : Boolean(result[CREATED_AT_PERSIST_KEY]);
      textarea.value = list.join('\n');
      whitelistTextarea.value = whitelist.join('\n');
      displayTextarea.value = displayList.join('\n');
      autoMapCheckbox.checked = autoMap;
      blockBotsCheckbox.checked = blockBots;
      persistBotsCheckbox.checked = persistBots;
      filterByCreatedAtCheckbox.checked = createdAtEnabled;
      createdAtInput.value = createdAtDate;
      persistCreatedAtCheckbox.checked = persistCreatedAt;
    }
  });
  if (maybePromise && typeof maybePromise.then === 'function') {
    maybePromise.then((result) => {
      const list = Array.isArray(result[BLOCKLIST_KEY]) ? result[BLOCKLIST_KEY] : [];
      const whitelist = Array.isArray(result[WHITELIST_KEY]) ? result[WHITELIST_KEY] : [];
      const displayList = Array.isArray(result[DISPLAY_BLOCKLIST_KEY]) ? result[DISPLAY_BLOCKLIST_KEY] : [];
      const autoMap = result[AUTO_MAP_KEY] === undefined ? true : Boolean(result[AUTO_MAP_KEY]);
      const blockBots = result[BLOCK_BOTS_KEY] === undefined ? true : Boolean(result[BLOCK_BOTS_KEY]);
      const persistBots = result[PERSIST_BOTS_KEY] === undefined ? false : Boolean(result[PERSIST_BOTS_KEY]);
      const createdAtEnabled =
        result[CREATED_AT_FILTER_KEY] === undefined ? true : Boolean(result[CREATED_AT_FILTER_KEY]);
      const createdAtDate = normalizeCreatedAtInput(result[CREATED_AT_DATE_KEY]);
      const persistCreatedAt =
        result[CREATED_AT_PERSIST_KEY] === undefined ? false : Boolean(result[CREATED_AT_PERSIST_KEY]);
      textarea.value = list.join('\n');
      whitelistTextarea.value = whitelist.join('\n');
      displayTextarea.value = displayList.join('\n');
      autoMapCheckbox.checked = autoMap;
      blockBotsCheckbox.checked = blockBots;
      persistBotsCheckbox.checked = persistBots;
      filterByCreatedAtCheckbox.checked = createdAtEnabled;
      createdAtInput.value = createdAtDate;
      persistCreatedAtCheckbox.checked = persistCreatedAt;
    });
  }
}

function saveBlocklist() {
  const lines = textarea.value.split(/\r?\n/);
  const whitelistLines = whitelistTextarea.value.split(/\r?\n/);
  const displayLines = displayTextarea.value.split(/\r?\n/);
  const normalized = Array.from(
    new Set(lines.map(normalizeUsername).filter(Boolean))
  ).sort();
  const normalizedWhitelist = Array.from(
    new Set(whitelistLines.map(normalizeUsername).filter(Boolean))
  ).sort();
  const normalizedDisplay = Array.from(
    new Set(displayLines.map(normalizeDisplayName).filter(Boolean))
  ).sort();
  const autoMap = Boolean(autoMapCheckbox.checked);
  const blockBots = Boolean(blockBotsCheckbox.checked);
  const persistBots = Boolean(persistBotsCheckbox.checked);
  const createdAtEnabled = Boolean(filterByCreatedAtCheckbox.checked);
  const createdAtDate = normalizeCreatedAtInput(createdAtInput.value);
  const persistCreatedAt = Boolean(persistCreatedAtCheckbox.checked);
  const maybePromise = storage.set(
    {
      [BLOCKLIST_KEY]: normalized,
      [WHITELIST_KEY]: normalizedWhitelist,
      [DISPLAY_BLOCKLIST_KEY]: normalizedDisplay,
      [AUTO_MAP_KEY]: autoMap,
      [BLOCK_BOTS_KEY]: blockBots,
      [PERSIST_BOTS_KEY]: persistBots,
      [CREATED_AT_FILTER_KEY]: createdAtEnabled,
      [CREATED_AT_DATE_KEY]: createdAtDate,
      [CREATED_AT_PERSIST_KEY]: persistCreatedAt
    },
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
