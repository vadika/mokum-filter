'use strict';

const DEFAULT_TITLE = 'Mokum Comment Filter';

function updateAction(tabId, count) {
  const text = count > 0 ? String(count) : '';
  const title = count > 0 ? `Blocked comments: ${count}` : DEFAULT_TITLE;
  if (tabId == null) return;
  chrome.action.setBadgeText({ tabId, text });
  chrome.action.setBadgeBackgroundColor({ tabId, color: '#6b7280' });
  chrome.action.setTitle({ tabId, title });
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (!message || message.type !== 'blockedCount') return;
  const tabId = sender.tab && sender.tab.id;
  updateAction(tabId, Number(message.count) || 0);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  // Clear badge for removed tabs just in case.
  updateAction(tabId, 0);
});
