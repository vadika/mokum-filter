'use strict';

const ext = typeof browser !== 'undefined' ? browser : chrome;
const BLOCKLIST_KEY = 'blockedUsers';
const DISPLAY_BLOCKLIST_KEY = 'blockedDisplayNames';
const HIDDEN_CLASS = 'mokum-comment-filter-hidden';
const COMMENT_SELECTOR = '.bem-post__comment';
const COMMENT_REST_SELECTOR = '.bem-post__comment-rest';
const COMMENT_TEXT_SELECTOR = '.bem-post__comment-text';

const storage = ext.storage && ext.storage.sync ? ext.storage.sync : ext.storage.local;
let blockedUsers = new Set();
let blockedDisplayNames = new Set();
let notifyTimer = null;
let applyTimer = null;

function normalizeUsername(value) {
  if (!value) return '';
  return value.trim().replace(/^@+/, '').toLowerCase();
}

function normalizeDisplayName(value) {
  if (!value) return '';
  return value.trim().toLowerCase();
}

function isUserPath(pathname) {
  if (!pathname || pathname === '/') return false;
  if (!/^\/[A-Za-z0-9_][A-Za-z0-9_-]*$/.test(pathname)) return false;
  const name = pathname.slice(1);
  // Exclude known non-user paths that also match the pattern.
  if (name === 's' || name === 'filter' || name === 'users' || name === 'api') return false;
  return true;
}

function extractCommentId(commentEl) {
  const anchor = commentEl.querySelector('a[name^="c"]');
  if (anchor && anchor.getAttribute('name')) {
    const raw = anchor.getAttribute('name');
    const match = raw.match(/^c(\d+)/);
    if (match) return match[1];
  }
  const link = commentEl.querySelector('a[href*="#c"]');
  if (link) {
    try {
      const url = new URL(link.getAttribute('href'), window.location.origin);
      const hashMatch = url.hash.match(/^#c(\d+)/);
      if (hashMatch) return hashMatch[1];
    } catch (err) {
      return null;
    }
  }
  return null;
}

function parseStoreData() {
  const storeScript = document.querySelector('script[data-js-react-on-rails-store="mokumStore"]');
  if (!storeScript) return null;
  try {
    return JSON.parse(storeScript.textContent);
  } catch (err) {
    return null;
  }
}

function buildStoreMaps() {
  const store = parseStoreData();
  if (!store || !store.river_manager) return null;
  const users = store.river_manager.users || {};
  const entries = store.river_manager.entries || [];
  const userIdToDisplayName = new Map();
  const userIdToName = new Map();
  const usernameToDisplayName = new Map();
  Object.keys(users).forEach((id) => {
    const user = users[id];
    if (!user) return;
    if (user.display_name) userIdToDisplayName.set(String(user.id), user.display_name);
    if (user.name) userIdToName.set(String(user.id), user.name);
    if (user.name && user.display_name) {
      usernameToDisplayName.set(String(user.name).toLowerCase(), user.display_name);
    }
  });
  const commentIdToUserId = new Map();
  entries.forEach((entry) => {
    if (!entry || !Array.isArray(entry.comments)) return;
    entry.comments.forEach((comment) => {
      if (!comment || !comment.id || !comment.user_id) return;
      commentIdToUserId.set(String(comment.id), String(comment.user_id));
    });
  });
  return {
    commentIdToUserId,
    userIdToDisplayName,
    userIdToName,
    usernameToDisplayName
  };
}

function extractAuthorInfo(commentEl) {
  const rest = commentEl.querySelector(COMMENT_REST_SELECTOR);
  const info = {
    username: null,
    displayName: null,
    userId: null,
    commentId: extractCommentId(commentEl),
  };
  if (!rest) return info;
  const links = Array.from(rest.querySelectorAll('a[href]'));
  for (const link of links) {
    if (link.closest(COMMENT_TEXT_SELECTOR)) continue;
    let url;
    try {
      url = new URL(link.getAttribute('href'), window.location.origin);
    } catch (err) {
      continue;
    }
    if (url.origin !== window.location.origin) continue;
    if (!isUserPath(url.pathname)) continue;
    info.username = url.pathname.slice(1);
    const linkText = link.textContent ? link.textContent.trim() : '';
    if (!info.username && linkText) info.username = linkText;
    break;
  }
  return info;
}

function applyBlocklistToComments(root) {
  const scope = root || document;
  const maps = buildStoreMaps();
  const comments = scope.querySelectorAll ? scope.querySelectorAll(COMMENT_SELECTOR) : [];
  comments.forEach((commentEl) => {
    const authorInfo = extractAuthorInfo(commentEl);
    if (!authorInfo) return;
    let username = authorInfo.username;
    let displayName = authorInfo.displayName;
    if (maps && authorInfo.commentId) {
      const userId = maps.commentIdToUserId.get(String(authorInfo.commentId));
      if (userId) {
        username = username || maps.userIdToName.get(String(userId)) || null;
        displayName = displayName || maps.userIdToDisplayName.get(String(userId)) || null;
      }
    }
    if (maps && username && !displayName) {
      displayName = maps.usernameToDisplayName.get(String(username).toLowerCase()) || displayName;
    }
    const normalizedUsername = normalizeUsername(username);
    const normalizedDisplayName = normalizeDisplayName(displayName);
    const shouldHide =
      (normalizedUsername && blockedUsers.has(normalizedUsername)) ||
      (normalizedDisplayName && blockedDisplayNames.has(normalizedDisplayName));
    commentEl.classList.toggle(HIDDEN_CLASS, shouldHide);
  });
  scheduleBlockedCountUpdate();
}

function scheduleBlockedCountUpdate() {
  if (notifyTimer) clearTimeout(notifyTimer);
  notifyTimer = setTimeout(() => {
    const count = document.querySelectorAll(`.${HIDDEN_CLASS}`).length;
    ext.runtime.sendMessage({ type: 'blockedCount', count });
  }, 150);
}

function loadBlocklist() {
  return new Promise((resolve) => {
    const maybePromise = storage.get([BLOCKLIST_KEY, DISPLAY_BLOCKLIST_KEY], (result) => {
      if (result) {
        const list = Array.isArray(result[BLOCKLIST_KEY]) ? result[BLOCKLIST_KEY] : [];
        const displayList = Array.isArray(result[DISPLAY_BLOCKLIST_KEY]) ? result[DISPLAY_BLOCKLIST_KEY] : [];
        blockedUsers = new Set(list.map(normalizeUsername).filter(Boolean));
        blockedDisplayNames = new Set(displayList.map(normalizeDisplayName).filter(Boolean));
        resolve();
      }
    });
    if (maybePromise && typeof maybePromise.then === 'function') {
      maybePromise.then((result) => {
        const list = Array.isArray(result[BLOCKLIST_KEY]) ? result[BLOCKLIST_KEY] : [];
        const displayList = Array.isArray(result[DISPLAY_BLOCKLIST_KEY]) ? result[DISPLAY_BLOCKLIST_KEY] : [];
        blockedUsers = new Set(list.map(normalizeUsername).filter(Boolean));
        blockedDisplayNames = new Set(displayList.map(normalizeDisplayName).filter(Boolean));
        resolve();
      });
    }
  });
}

function injectStyles() {
  if (document.getElementById('mokum-comment-filter-style')) return;
  const style = document.createElement('style');
  style.id = 'mokum-comment-filter-style';
  style.textContent = `.${HIDDEN_CLASS} { display: none !important; }`;
  document.head.appendChild(style);
}

function observeComments() {
  const scheduleApply = (root) => {
    if (applyTimer) clearTimeout(applyTimer);
    applyTimer = setTimeout(() => applyBlocklistToComments(root || document), 50);
  };
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        for (const node of mutation.addedNodes) {
          if (!(node instanceof Element)) continue;
          if (node.matches && node.matches(COMMENT_SELECTOR)) {
            scheduleApply(node.parentElement || node);
          } else if (node.querySelector && node.querySelector(COMMENT_SELECTOR)) {
            scheduleApply(node);
          }
        }
      } else if (mutation.type === 'attributes') {
        const target = mutation.target;
        if (!(target instanceof Element)) continue;
        if (target.matches(COMMENT_SELECTOR) || target.closest('.bem-post__comments')) {
          const postEl = target.closest('.bem-post[data-post-id]');
          scheduleApply(postEl || target);
        }
      }
    }
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'style', 'hidden', 'aria-expanded']
  });
}

function hookMoreComments() {
  document.addEventListener(
    'click',
    (event) => {
      const trigger = event.target.closest && event.target.closest('.bem-post__more-comments');
      if (!trigger) return;
      const postEl = trigger.closest('.bem-post[data-post-id]');
      const scope = postEl || document;
      // Re-apply after likely async expansion.
      setTimeout(() => applyBlocklistToComments(scope), 100);
      setTimeout(() => applyBlocklistToComments(scope), 600);
      setTimeout(() => applyBlocklistToComments(scope), 1500);
    },
    true
  );
}

function init() {
  injectStyles();
  loadBlocklist().then(() => applyBlocklistToComments(document));
  observeComments();
  hookMoreComments();
  ext.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync' && areaName !== 'local') return;
    if (changes[BLOCKLIST_KEY]) {
      const newList = Array.isArray(changes[BLOCKLIST_KEY].newValue)
        ? changes[BLOCKLIST_KEY].newValue
        : [];
      blockedUsers = new Set(newList.map(normalizeUsername).filter(Boolean));
    }
    if (changes[DISPLAY_BLOCKLIST_KEY]) {
      const newList = Array.isArray(changes[DISPLAY_BLOCKLIST_KEY].newValue)
        ? changes[DISPLAY_BLOCKLIST_KEY].newValue
        : [];
      blockedDisplayNames = new Set(newList.map(normalizeDisplayName).filter(Boolean));
    }
    applyBlocklistToComments(document);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
