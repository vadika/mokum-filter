'use strict';

const ext = typeof browser !== 'undefined' ? browser : chrome;
const BLOCKLIST_KEY = 'blockedUsers';
const WHITELIST_KEY = 'whitelistedUsers';
const DISPLAY_BLOCKLIST_KEY = 'blockedDisplayNames';
const AUTO_MAP_KEY = 'autoMapUsernames';
const BLOCK_BOTS_KEY = 'blockBotsByDefault';
const PERSIST_BOTS_KEY = 'persistBotUsers';
const HIDDEN_CLASS = 'mokum-comment-filter-hidden';
const COMMENT_SELECTOR = '.bem-post__comment';
const COMMENT_REST_SELECTOR = '.bem-post__comment-rest';
const COMMENT_TEXT_SELECTOR = '.bem-post__comment-text';

const storage = ext.storage && ext.storage.sync ? ext.storage.sync : ext.storage.local;
let blockedUsers = new Set();
let whitelistedUsers = new Set();
let blockedDisplayNames = new Set();
let autoMapUsernames = false;
let blockBotsByDefault = true;
let persistBotUsers = false;
let notifyTimer = null;
let applyTimer = null;
let reapplyTimer = null;
let profileFetchTimer = null;
let profileFetchActive = false;
const profileFetchQueue = new Set();
const visibleComments = new WeakSet();
const observedComments = new WeakSet();
let visibilityObserver = null;
const displayNameCache = new Map();
const displayNamePending = new Map();
const userCache = new Map();
const userPending = new Map();
const profileCountsPending = new Map();
const profileCountsFailed = new Set();
const commentInfoCache = new Map();
const commentInfoPending = new Map();

function normalizeUsername(value) {
  if (!value) return '';
  return value.trim().replace(/^@+/, '').toLowerCase();
}

function normalizeDisplayName(value) {
  if (!value) return '';
  return value.trim().toLowerCase();
}

function cacheDisplayName(username, displayName) {
  const normalizedUsername = normalizeUsername(username);
  if (!normalizedUsername) return;
  const normalizedDisplayName = displayName ? normalizeDisplayName(displayName) : '';
  displayNameCache.set(normalizedUsername, normalizedDisplayName || null);
}

function cacheUser(username, user) {
  const normalizedUsername = normalizeUsername(username);
  if (!normalizedUsername) return;
  userCache.set(normalizedUsername, user || null);
  if (user && (user.display_name || user.displayName || user.name)) {
    const displayName = user.display_name || user.displayName || user.name || null;
    cacheDisplayName(normalizedUsername, displayName);
  }
}

function addUsernameToBlocklist(username) {
  const normalized = normalizeUsername(username);
  if (!normalized || blockedUsers.has(normalized)) return;
  blockedUsers.add(normalized);
  const payload = { [BLOCKLIST_KEY]: Array.from(blockedUsers).sort() };
  const maybePromise = storage.set(payload, () => {});
  if (maybePromise && typeof maybePromise.then === 'function') {
    maybePromise.then(() => {});
  }
}

function getApiOrigin() {
  return window.location.origin.replace('://www.', '://');
}

function canFetchFromNetwork() {
  return window.location.protocol === 'http:' || window.location.protocol === 'https:';
}

function ensureVisibilityObserver() {
  if (visibilityObserver || typeof IntersectionObserver === 'undefined') return;
  visibilityObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const target = entry.target;
        visibleComments.add(target);
        visibilityObserver.unobserve(target);
        scheduleReapply(target);
      });
    },
    { root: null, rootMargin: '200px', threshold: 0 }
  );
}

function markCommentForVisibility(commentEl) {
  if (!commentEl || observedComments.has(commentEl)) return;
  observedComments.add(commentEl);
  if (typeof IntersectionObserver === 'undefined') {
    visibleComments.add(commentEl);
    return;
  }
  ensureVisibilityObserver();
  visibilityObserver.observe(commentEl);
}

function isCommentVisible(commentEl) {
  if (!commentEl) return false;
  if (visibleComments.has(commentEl)) return true;
  markCommentForVisibility(commentEl);
  return false;
}

function scheduleReapply(root) {
  if (reapplyTimer) clearTimeout(reapplyTimer);
  reapplyTimer = setTimeout(() => {
    applyBlocklistToComments(root || document);
  }, 150);
}

function getCountValue(counts, keys) {
  if (!counts) return null;
  for (const key of keys) {
    const value = counts[key];
    if (typeof value === 'number') return value;
  }
  return null;
}

function isBotUser(user) {
  if (!user) return false;
  const hasPrivateFeed =
    user.status === 'private' ||
    user.status === 'fyeo';
  if (!hasPrivateFeed) return false;
  const counts = user.counts || {};
  const subscribers = getCountValue(counts, ['subscribers', 'subscribers_count', 'subscriber_count']);
  const subscriptions = getCountValue(counts, ['subscriptions', 'subscriptions_count', 'subscription_count']);
  if (subscribers === null || subscriptions === null) return false;
  return subscribers === 0 && subscriptions === 0;
}

function parseCountFromText(text) {
  if (!text) return null;
  const match = text.match(/[\d\s.,]+/);
  if (!match) return null;
  const raw = match[0].replace(/[^\d]/g, '');
  if (!raw) return null;
  const value = Number.parseInt(raw, 10);
  return Number.isNaN(value) ? null : value;
}

function extractStatsCountsFromRoot(root) {
  if (!root) return null;
  const stats = root.querySelector ? root.querySelector('.stats') : null;
  if (!stats) return null;
  const links = Array.from(stats.querySelectorAll('.stats-item a[href]'));
  let username = null;
  let subscribers = null;
  let subscriptions = null;
  links.forEach((link) => {
    let url;
    try {
      url = new URL(link.getAttribute('href'), window.location.origin);
    } catch (err) {
      return;
    }
    if (url.origin !== window.location.origin) return;
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return;
    if (parts[1] !== 'subscriptions' && parts[1] !== 'subscribers') return;
    if (!username) username = parts[0];
    const text = link.textContent || '';
    let count = parseCountFromText(text);
    if (count === null && !/\d/.test(text)) count = 0;
    if (count === null) return;
    if (parts[1] === 'subscriptions') subscriptions = count;
    if (parts[1] === 'subscribers') subscribers = count;
  });
  if (!username) return null;
  const counts = {};
  if (typeof subscribers === 'number') counts.subscribers = subscribers;
  if (typeof subscriptions === 'number') counts.subscriptions = subscriptions;
  if (Object.keys(counts).length === 0) return null;
  return { username, counts };
}

function extractStatsCounts() {
  return extractStatsCountsFromRoot(document);
}

function extractProfileStatusFromRoot(root) {
  if (!root || !root.querySelector) return null;
  const feedInfo = root.querySelector('.bem-feedinfo__description');
  if (!feedInfo) return null;
  if (feedInfo.querySelector('.fa-eye')) return 'fyeo';
  if (feedInfo.querySelector('.fa-lock')) return 'private';
  const text = feedInfo.textContent ? feedInfo.textContent.toLowerCase() : '';
  if (text.includes('for your eyes only')) return 'fyeo';
  if (text.includes('private feed')) return 'private';
  return null;
}

function extractProfileInfoFromRoot(root) {
  const statsCounts = extractStatsCountsFromRoot(root);
  const status = extractProfileStatusFromRoot(root);
  if (!statsCounts && !status) return null;
  return {
    username: statsCounts ? statsCounts.username : null,
    counts: statsCounts ? statsCounts.counts : null,
    status
  };
}

function hasBotCounts(user) {
  if (!user || !user.counts) return false;
  const subscribers = getCountValue(user.counts, ['subscribers', 'subscribers_count', 'subscriber_count']);
  const subscriptions = getCountValue(user.counts, ['subscriptions', 'subscriptions_count', 'subscription_count']);
  return subscribers !== null && subscriptions !== null;
}

function fetchProfileCountsForUsername(username) {
  const normalizedUsername = normalizeUsername(username);
  if (!normalizedUsername) return Promise.resolve(null);
  if (!canFetchFromNetwork()) return Promise.resolve(null);
  if (profileCountsFailed.has(normalizedUsername)) return Promise.resolve(null);
  if (profileCountsPending.has(normalizedUsername)) {
    return profileCountsPending.get(normalizedUsername);
  }
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutId = controller
    ? setTimeout(() => controller.abort(), 2500)
    : null;
  const request = fetch(new URL(`/${encodeURIComponent(normalizedUsername)}`, getApiOrigin()), {
    credentials: 'same-origin',
    headers: { Accept: 'text/html' },
    signal: controller ? controller.signal : undefined,
    cache: 'force-cache',
  })
    .then((resp) => (resp.ok ? resp.text() : null))
    .then((html) => {
      if (!html) return null;
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const info = extractProfileInfoFromRoot(doc);
      if (!info) return null;
      const key = normalizeUsername(info.username || normalizedUsername);
      if (!key) return null;
      const user = userCache.get(key) || { name: key };
      if (info.status) user.status = info.status;
      if (info.counts) {
        if (!user.counts) user.counts = {};
        Object.assign(user.counts, info.counts);
      }
      userCache.set(key, user);
      return user;
    })
    .catch(() => null)
    .finally(() => {
      if (timeoutId) clearTimeout(timeoutId);
      profileCountsPending.delete(normalizedUsername);
    });
  profileCountsPending.set(normalizedUsername, request);
  return request.then((result) => {
    if (!result) profileCountsFailed.add(normalizedUsername);
    return result;
  });
}

function processProfileFetchQueue() {
  if (profileFetchActive) return;
  const next = profileFetchQueue.values().next().value;
  if (!next) return;
  profileFetchQueue.delete(next);
  profileFetchActive = true;
  fetchProfileCountsForUsername(next)
    .then(() => scheduleReapply(document))
    .finally(() => {
      profileFetchActive = false;
      if (profileFetchQueue.size > 0) {
        profileFetchTimer = setTimeout(processProfileFetchQueue, 400);
      } else {
        profileFetchTimer = null;
      }
    });
}

function scheduleProfileFetch(username) {
  const normalizedUsername = normalizeUsername(username);
  if (!normalizedUsername) return;
  if (!canFetchFromNetwork()) return;
  if (profileCountsPending.has(normalizedUsername) || profileCountsFailed.has(normalizedUsername)) return;
  if (profileFetchQueue.has(normalizedUsername)) return;
  profileFetchQueue.add(normalizedUsername);
  if (!profileFetchTimer) {
    profileFetchTimer = setTimeout(processProfileFetchQueue, 600);
  }
}

function logBlockReason(details) {
  try {
    if (!details || !details.reasons || !details.reasons.includes('bot rule')) return;
    const parts = [];
    if (details.username) parts.push(`@${details.username}`);
    if (details.displayName) parts.push(`"${details.displayName}"`);
    if (details.commentId) parts.push(`comment ${details.commentId}`);
    const reasonText = details.reasons.join(', ');
    console.info(`[Mokum Comment Filter] Blocked ${parts.join(' ')} (${reasonText}).`);
  } catch (err) {
    // ignore logging failures
  }
}

function fetchDisplayNameForUsername(username) {
  const normalizedUsername = normalizeUsername(username);
  if (!normalizedUsername) return Promise.resolve(null);
  if (displayNameCache.has(normalizedUsername)) {
    return Promise.resolve(displayNameCache.get(normalizedUsername));
  }
  if (displayNamePending.has(normalizedUsername)) {
    return displayNamePending.get(normalizedUsername);
  }
  const request = fetch(
    new URL(`/api/v1/users/${encodeURIComponent(normalizedUsername)}`, getApiOrigin()),
    {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  })
    .then((resp) => (resp.ok ? resp.json() : null))
    .then((data) => {
      const user = data && (data.user || data);
      const displayName = user ? user.display_name || user.displayName || user.name : null;
      cacheDisplayName(normalizedUsername, displayName);
      return displayNameCache.get(normalizedUsername);
    })
    .catch(() => {
      cacheDisplayName(normalizedUsername, null);
      return null;
    })
    .finally(() => {
      displayNamePending.delete(normalizedUsername);
    });
  displayNamePending.set(normalizedUsername, request);
  return request;
}

function fetchUserForUsername(username) {
  const normalizedUsername = normalizeUsername(username);
  if (!normalizedUsername) return Promise.resolve(null);
  if (!canFetchFromNetwork()) return Promise.resolve(null);
  if (userCache.has(normalizedUsername)) {
    return Promise.resolve(userCache.get(normalizedUsername));
  }
  if (userPending.has(normalizedUsername)) {
    return userPending.get(normalizedUsername);
  }
  const request = fetch(
    new URL(`/api/v1/users/${encodeURIComponent(normalizedUsername)}`, getApiOrigin()),
    {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    }
  )
    .then((resp) => (resp.ok ? resp.json() : null))
    .then((data) => {
      const user = data && (data.user || data);
      cacheUser(normalizedUsername, user || null);
      if (user && blockBotsByDefault && !hasBotCounts(user)) {
        scheduleProfileFetch(normalizedUsername);
      }
      return userCache.get(normalizedUsername);
    })
    .catch(() => {
      cacheUser(normalizedUsername, null);
      return null;
    })
    .finally(() => {
      userPending.delete(normalizedUsername);
    });
  userPending.set(normalizedUsername, request);
  return request;
}

function parsePostInfo(postEl) {
  if (!postEl) return null;
  const postId = postEl.getAttribute('data-post-id') || null;
  let href = null;
  const link = postEl.querySelector('.bem-post__timestamp-link');
  if (link) {
    href = link.getAttribute('href');
  } else {
    const anchors = Array.from(postEl.querySelectorAll('a[href]'));
    for (const anchor of anchors) {
      const value = anchor.getAttribute('href');
      if (value && postId && value.includes(`/${postId}`)) {
        href = value;
        break;
      }
    }
  }
  if (!href) return { postId };
  try {
    const url = new URL(href, window.location.origin);
    const match = url.pathname.match(/^\/([^/]+)\/(\d+)/);
    if (match) {
      return { authorSlug: match[1], postId: match[2] || postId };
    }
  } catch (err) {
    return { postId };
  }
  return { postId };
}

function fetchCommentAuthor(commentEl, maps) {
  const commentId = extractCommentId(commentEl);
  if (!commentId) return Promise.resolve(null);
  if (commentInfoCache.has(commentId)) return Promise.resolve(commentInfoCache.get(commentId));
  if (commentInfoPending.has(commentId)) return commentInfoPending.get(commentId);
  const postEl = commentEl.closest('.bem-post[data-post-id]');
  const info = parsePostInfo(postEl);
  if (!info || !info.authorSlug || !info.postId) {
    commentInfoCache.set(commentId, null);
    return Promise.resolve(null);
  }
  const url = new URL(
    `/api/v1/posts/${encodeURIComponent(info.authorSlug)}/${encodeURIComponent(info.postId)}/comments/${encodeURIComponent(commentId)}`,
    getApiOrigin()
  );
  const request = fetch(url, {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  })
    .then((resp) => (resp.ok ? resp.json() : null))
    .then((data) => {
      const comment = data && (data.comment || data);
      const userId = comment && (comment.user_id || comment.userId);
      let username = null;
      let displayName = null;
      if (comment && comment.user) {
        username = comment.user.name || username;
        displayName = comment.user.display_name || comment.user.displayName || displayName;
      }
      if (comment) {
        username = comment.username || username;
        displayName = comment.display_name || comment.displayName || displayName;
      }
      if (userId && maps) {
        username = username || maps.userIdToName.get(String(userId)) || null;
        displayName = displayName || maps.userIdToDisplayName.get(String(userId)) || null;
      }
      const result = { username, displayName };
      if (username || displayName) {
        commentInfoCache.set(commentId, result);
        if (username) cacheDisplayName(username, displayName);
        return result;
      }
      commentInfoCache.set(commentId, null);
      return null;
    })
    .catch(() => {
      commentInfoCache.set(commentId, null);
      return null;
    })
    .finally(() => {
      commentInfoPending.delete(commentId);
    });
  commentInfoPending.set(commentId, request);
  return request;
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
  const userIdToUser = new Map();
  const usernameToUser = new Map();
  Object.keys(users).forEach((id) => {
    const user = users[id];
    if (!user) return;
    if (user.display_name) userIdToDisplayName.set(String(user.id), user.display_name);
    if (user.name) userIdToName.set(String(user.id), user.name);
    if (user.name && user.display_name) {
      usernameToDisplayName.set(String(user.name).toLowerCase(), user.display_name);
    }
    if (user.id != null) userIdToUser.set(String(user.id), user);
    if (user.name) usernameToUser.set(String(user.name).toLowerCase(), user);
  });
  const commentIdToUserId = new Map();
  entries.forEach((entry) => {
    if (!entry || !Array.isArray(entry.comments)) return;
    entry.comments.forEach((comment) => {
      if (!comment || !comment.id || !comment.user_id) return;
      commentIdToUserId.set(String(comment.id), String(comment.user_id));
    });
  });
  const statsCounts = extractStatsCounts();
  if (statsCounts) {
    const key = normalizeUsername(statsCounts.username);
    const user = key ? usernameToUser.get(key) : null;
    if (user) {
      if (!user.counts) user.counts = {};
      Object.assign(user.counts, statsCounts.counts);
    }
  }
  const profileInfo = extractProfileInfoFromRoot(document);
  if (profileInfo) {
    const key = normalizeUsername(profileInfo.username);
    if (key) {
      const user = userCache.get(key) || usernameToUser.get(key) || { name: key };
      if (profileInfo.status) user.status = profileInfo.status;
      if (profileInfo.counts) {
        if (!user.counts) user.counts = {};
        Object.assign(user.counts, profileInfo.counts);
      }
      userCache.set(key, user);
      if (usernameToUser.has(key)) {
        usernameToUser.set(key, user);
      }
    }
  }
  return {
    commentIdToUserId,
    userIdToDisplayName,
    userIdToName,
    usernameToDisplayName,
    userIdToUser,
    usernameToUser
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
  if (!info.username) {
    // Fallback: some expanded comments only show author inside comment text.
    const textLinks = Array.from(rest.querySelectorAll(`${COMMENT_TEXT_SELECTOR} a[href]`));
    for (const link of textLinks) {
      let url;
      try {
        url = new URL(link.getAttribute('href'), window.location.origin);
      } catch (err) {
        continue;
      }
      if (url.origin !== window.location.origin) continue;
      if (!isUserPath(url.pathname)) continue;
      const linkText = link.textContent ? link.textContent.trim() : '';
      if (linkText && !linkText.startsWith('@')) continue;
      info.username = url.pathname.slice(1);
      break;
    }
  }
  return info;
}

function applyBlocklistToComments(root) {
  const scope = root || document;
  const maps = buildStoreMaps();
  let comments = [];
  if (scope.matches && scope.matches(COMMENT_SELECTOR)) {
    comments = [scope];
  } else if (scope.querySelectorAll) {
    comments = Array.from(scope.querySelectorAll(COMMENT_SELECTOR));
  }
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
    if (maps && username) {
      const cachedFromStore = maps.usernameToDisplayName.get(String(username).toLowerCase());
      if (cachedFromStore) cacheDisplayName(username, cachedFromStore);
    }
    let userRecord = null;
    if (maps) {
      if (authorInfo.commentId) {
        const userId = maps.commentIdToUserId.get(String(authorInfo.commentId));
        if (userId) {
          userRecord = maps.userIdToUser.get(String(userId)) || userRecord;
        }
      }
      if (!userRecord && username) {
        userRecord = maps.usernameToUser.get(String(username).toLowerCase()) || null;
      }
    }
    if (maps && username && !displayName) {
      displayName = maps.usernameToDisplayName.get(String(username).toLowerCase()) || displayName;
    }
    if (!username && maps && authorInfo.commentId) {
      const cached = commentInfoCache.get(String(authorInfo.commentId));
      if (cached === undefined) {
        fetchCommentAuthor(commentEl, maps).then(() => applyBlocklistToComments(commentEl));
      } else if (cached) {
        username = cached.username || username;
        displayName = cached.displayName || displayName;
      }
    }
    if (!displayName && username && blockedDisplayNames.size > 0) {
      const cached = displayNameCache.get(normalizeUsername(username));
      if (cached === undefined) {
        if (isCommentVisible(commentEl)) {
          fetchDisplayNameForUsername(username).then(() => scheduleReapply(commentEl));
        }
      } else if (cached) {
        displayName = cached;
      }
    }
    const normalizedUsername = normalizeUsername(username);
    const normalizedDisplayName = normalizeDisplayName(displayName);
    if (normalizedUsername) {
      commentEl.dataset.mokumUsername = normalizedUsername;
    }
    if (normalizedUsername && whitelistedUsers.has(normalizedUsername)) {
      commentEl.classList.remove(HIDDEN_CLASS);
      return;
    }
    const reasons = [];
    if (normalizedUsername && blockedUsers.has(normalizedUsername)) reasons.push('blocked username');
    if (normalizedDisplayName && blockedDisplayNames.has(normalizedDisplayName)) reasons.push('blocked display name');
    let botUser = userRecord;
    if (normalizedUsername && userCache.has(normalizedUsername)) {
      const cached = userCache.get(normalizedUsername);
      if (!botUser) {
        botUser = cached;
      } else if (cached) {
        if (!botUser.status && cached.status) botUser.status = cached.status;
        if (!hasBotCounts(botUser) && cached.counts) {
          if (!botUser.counts) botUser.counts = {};
          Object.assign(botUser.counts, cached.counts);
        }
      }
    }
    if (blockBotsByDefault && normalizedUsername) {
      if (!botUser && !userPending.has(normalizedUsername)) {
        if (isCommentVisible(commentEl)) {
          fetchUserForUsername(normalizedUsername).then(() => scheduleReapply(commentEl));
        }
      } else if (
        botUser &&
        !hasBotCounts(botUser) &&
        !profileCountsPending.has(normalizedUsername) &&
        !profileCountsFailed.has(normalizedUsername)
      ) {
        if (isCommentVisible(commentEl)) {
          scheduleProfileFetch(normalizedUsername);
        }
      }
    }
    if (blockBotsByDefault && isBotUser(botUser)) reasons.push('bot rule');
    const shouldHide = reasons.length > 0;
    commentEl.classList.toggle(HIDDEN_CLASS, shouldHide);
    if (shouldHide) {
      logBlockReason({
        username: normalizedUsername || username || null,
        displayName: displayName || null,
        commentId: authorInfo.commentId || null,
        reasons
      });
    }
    if (
      shouldHide &&
      autoMapUsernames &&
      normalizedDisplayName &&
      normalizedUsername &&
      !blockedUsers.has(normalizedUsername) &&
      reasons.includes('blocked display name')
    ) {
      addUsernameToBlocklist(normalizedUsername);
    }
    if (
      shouldHide &&
      persistBotUsers &&
      normalizedUsername &&
      !blockedUsers.has(normalizedUsername) &&
      reasons.includes('bot rule')
    ) {
      addUsernameToBlocklist(normalizedUsername);
    }
  });
  filterLikesList(scope, maps);
  scheduleBlockedCountUpdate();
}

function filterLikesList(root, maps) {
  const scope = root || document;
  const lists = scope.querySelectorAll ? scope.querySelectorAll('.bem-post__likes-list') : [];
  lists.forEach((list) => {
    const links = Array.from(list.querySelectorAll('a[href]'));
    const buttons = Array.from(list.querySelectorAll('button'));
    const likedTextMatch = list.textContent.match(/liked this.*$/i);
    const likedSuffix = likedTextMatch ? ` ${likedTextMatch[0].trim()}` : ' liked this';
    let removedAny = false;
    links.forEach((link) => {
      let url;
      try {
        url = new URL(link.getAttribute('href'), window.location.origin);
      } catch (err) {
        return;
      }
      if (url.origin !== window.location.origin) return;
      if (!isUserPath(url.pathname)) return;
      const username = url.pathname.slice(1);
      const normalizedUsername = normalizeUsername(username);
      let displayName = null;
      if (maps && username) {
        displayName = maps.usernameToDisplayName.get(String(username).toLowerCase()) || null;
      }
      const normalizedDisplayName = normalizeDisplayName(displayName);
      let userRecord = null;
      if (maps && username) {
        userRecord = maps.usernameToUser.get(String(username).toLowerCase()) || null;
      }
      const reasons = [];
      if (normalizedUsername && blockedUsers.has(normalizedUsername)) reasons.push('blocked username');
      if (normalizedDisplayName && blockedDisplayNames.has(normalizedDisplayName)) reasons.push('blocked display name');
      if (blockBotsByDefault && isBotUser(userRecord)) reasons.push('bot rule');
      const shouldHide = reasons.length > 0;
      if (!shouldHide) return;
      link.remove();
      removedAny = true;
    });
    if (removedAny) {
      const remainingLinks = Array.from(list.querySelectorAll('a[href]'));
      const otherButton = buttons.find((btn) => list.contains(btn)) || null;
      const parts = remainingLinks.map((link) => link.outerHTML);
      let joined = parts.length ? parts.join(', ') : '';
      if (otherButton) {
        const buttonHtml = otherButton.outerHTML;
        if (joined) {
          joined += `, and ${buttonHtml}`;
        } else {
          joined = `${buttonHtml}`;
        }
      }
      list.innerHTML = `${joined}${likedSuffix}`;
    }
  });
}

function scheduleBlockedCountUpdate() {
  if (notifyTimer) clearTimeout(notifyTimer);
  notifyTimer = setTimeout(() => {
    const count = document.querySelectorAll(`.${HIDDEN_CLASS}`).length;
    const names = new Set();
    document.querySelectorAll(`.${HIDDEN_CLASS}[data-mokum-username]`).forEach((el) => {
      const username = el.dataset.mokumUsername;
      if (username) names.add(username);
    });
    if (!ext.runtime || !ext.runtime.id) return;
    try {
      ext.runtime.sendMessage({ type: 'blockedCount', count, users: Array.from(names).sort() });
    } catch (err) {
      // ignore when extension context is gone (page reload / extension update)
    }
  }, 150);
}

function loadBlocklist() {
  return new Promise((resolve) => {
  const maybePromise = storage.get(
    [BLOCKLIST_KEY, WHITELIST_KEY, DISPLAY_BLOCKLIST_KEY, AUTO_MAP_KEY, BLOCK_BOTS_KEY, PERSIST_BOTS_KEY],
    (result) => {
      if (result) {
        const list = Array.isArray(result[BLOCKLIST_KEY]) ? result[BLOCKLIST_KEY] : [];
        const whitelist = Array.isArray(result[WHITELIST_KEY]) ? result[WHITELIST_KEY] : [];
        const displayList = Array.isArray(result[DISPLAY_BLOCKLIST_KEY]) ? result[DISPLAY_BLOCKLIST_KEY] : [];
        blockedUsers = new Set(list.map(normalizeUsername).filter(Boolean));
        whitelistedUsers = new Set(whitelist.map(normalizeUsername).filter(Boolean));
        blockedDisplayNames = new Set(displayList.map(normalizeDisplayName).filter(Boolean));
        autoMapUsernames = result[AUTO_MAP_KEY] === undefined ? true : Boolean(result[AUTO_MAP_KEY]);
        blockBotsByDefault = result[BLOCK_BOTS_KEY] === undefined ? true : Boolean(result[BLOCK_BOTS_KEY]);
        persistBotUsers = result[PERSIST_BOTS_KEY] === undefined ? false : Boolean(result[PERSIST_BOTS_KEY]);
        resolve();
      }
    }
  );
    if (maybePromise && typeof maybePromise.then === 'function') {
      maybePromise.then((result) => {
      const list = Array.isArray(result[BLOCKLIST_KEY]) ? result[BLOCKLIST_KEY] : [];
      const whitelist = Array.isArray(result[WHITELIST_KEY]) ? result[WHITELIST_KEY] : [];
      const displayList = Array.isArray(result[DISPLAY_BLOCKLIST_KEY]) ? result[DISPLAY_BLOCKLIST_KEY] : [];
      blockedUsers = new Set(list.map(normalizeUsername).filter(Boolean));
      whitelistedUsers = new Set(whitelist.map(normalizeUsername).filter(Boolean));
      blockedDisplayNames = new Set(displayList.map(normalizeDisplayName).filter(Boolean));
        autoMapUsernames = result[AUTO_MAP_KEY] === undefined ? true : Boolean(result[AUTO_MAP_KEY]);
        blockBotsByDefault = result[BLOCK_BOTS_KEY] === undefined ? true : Boolean(result[BLOCK_BOTS_KEY]);
        persistBotUsers = result[PERSIST_BOTS_KEY] === undefined ? false : Boolean(result[PERSIST_BOTS_KEY]);
        resolve();
      });
    }
  });
}

function injectStyles() {
  let style = document.getElementById('mokum-comment-filter-style');
  if (!style) {
    style = document.createElement('style');
    style.id = 'mokum-comment-filter-style';
    document.head.appendChild(style);
  }
  style.textContent = `.${HIDDEN_CLASS} { display: none !important; }`;
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
          const directComment = node.matches && node.matches(COMMENT_SELECTOR) ? node : null;
          const parentComment = !directComment && node.closest ? node.closest(COMMENT_SELECTOR) : null;
          const commentEl = directComment || parentComment;
          if (commentEl) {
            scheduleApply(commentEl);
          } else if (node.querySelector && node.querySelector(COMMENT_SELECTOR)) {
            scheduleApply(node);
          } else if (node.closest && node.closest('.bem-post__likes')) {
            filterLikesList(node.closest('.bem-post__likes'), buildStoreMaps());
          }
        }
      } else if (mutation.type === 'attributes') {
        const target = mutation.target;
        if (!(target instanceof Element)) continue;
        const commentEl = target.matches(COMMENT_SELECTOR)
          ? target
          : target.closest
            ? target.closest(COMMENT_SELECTOR)
            : null;
        if (commentEl) {
          scheduleApply(commentEl);
        } else if (target.closest('.bem-post__likes')) {
          filterLikesList(target.closest('.bem-post__likes'), buildStoreMaps());
        } else if (target.closest('.bem-post__comments')) {
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

  document.addEventListener(
    'click',
    (event) => {
      const trigger = event.target.closest && event.target.closest('.bem-post__likes-list button');
      if (!trigger) return;
      const likes = trigger.closest('.bem-post__likes');
      const scope = likes || document;
      // Re-apply after like list expansion.
      setTimeout(() => filterLikesList(scope, buildStoreMaps()), 100);
      setTimeout(() => filterLikesList(scope, buildStoreMaps()), 600);
      setTimeout(() => filterLikesList(scope, buildStoreMaps()), 1500);
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
    if (changes[WHITELIST_KEY]) {
      const newList = Array.isArray(changes[WHITELIST_KEY].newValue)
        ? changes[WHITELIST_KEY].newValue
        : [];
      whitelistedUsers = new Set(newList.map(normalizeUsername).filter(Boolean));
    }
    if (changes[DISPLAY_BLOCKLIST_KEY]) {
      const newList = Array.isArray(changes[DISPLAY_BLOCKLIST_KEY].newValue)
        ? changes[DISPLAY_BLOCKLIST_KEY].newValue
        : [];
      blockedDisplayNames = new Set(newList.map(normalizeDisplayName).filter(Boolean));
    }
    if (changes[AUTO_MAP_KEY]) {
      autoMapUsernames = Boolean(changes[AUTO_MAP_KEY].newValue);
    }
    if (changes[BLOCK_BOTS_KEY]) {
      blockBotsByDefault = Boolean(changes[BLOCK_BOTS_KEY].newValue);
    }
    if (changes[PERSIST_BOTS_KEY]) {
      persistBotUsers = Boolean(changes[PERSIST_BOTS_KEY].newValue);
    }
    applyBlocklistToComments(document);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
