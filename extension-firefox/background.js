'use strict';

const ext = typeof browser !== 'undefined' ? browser : chrome;

const DEFAULT_TITLE = 'Mokum Comment Filter';

function updateAction(tabId, count) {
  const text = count > 0 ? String(count) : '';
  const title = count > 0 ? `Blocked comments: ${count}` : DEFAULT_TITLE;
  if (tabId == null) return;
  const a = ext.browserAction || ext.action;
  if (!a) return;
  const p1 = a.setBadgeText({ tabId, text });
  const p2 = a.setBadgeBackgroundColor({ tabId, color: '#6b7280' });
  const p3 = a.setTitle({ tabId, title });
  [p1, p2, p3].forEach((p) => {
    if (p && typeof p.catch === 'function') p.catch(() => {});
  });
}

ext.runtime.onMessage.addListener((message, sender) => {
  if (!message || message.type !== 'blockedCount') return;
  const tabId = sender.tab && sender.tab.id;
  updateAction(tabId, Number(message.count) || 0);
});

ext.tabs.onRemoved.addListener((tabId) => {
  // Clear badge for removed tabs just in case.
  updateAction(tabId, 0);
});
