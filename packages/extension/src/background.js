const ext = typeof browser !== 'undefined' ? browser : chrome;
const isFirefox = typeof browser !== 'undefined';

const MSG_PREFIX = 'adslash:';
const MENU_ID = 'adslash-toggle';
const TUTORIAL_PATH = 'play/levels/index.html';

function setBadge(tabId, active) {
  if (typeof tabId !== 'number') return;
  try {
    ext.action.setBadgeText({ tabId, text: active ? 'ON' : '' });
    if (active) ext.action.setBadgeBackgroundColor({ tabId, color: '#0aa47f' });
  } catch (e) {}
}

async function toggleTab(tabId) {
  if (typeof tabId !== 'number') return;

  try {
    const res = await ext.tabs.sendMessage(tabId, { type: MSG_PREFIX + 'toggle' });
    if (res && typeof res === 'object') setBadge(tabId, !!res.active);
    return;
  } catch (e) {
    // 浏览器内部页面、扩展页、PDF 阅读器等没有内容脚本
  }

  try {
    ext.action.setBadgeText({ tabId, text: '!' });
    ext.action.setBadgeBackgroundColor({ tabId, color: '#b23b3b' });
    setTimeout(() => {
      try {
        ext.action.setBadgeText({ tabId, text: '' });
      } catch (err) {}
    }, 1500);
  } catch (e) {}
}

function ensureMenu() {
  const details = {
    id: MENU_ID,
    title: '页面清道夫：开启 / 关闭斩击',
    contexts: ['page', 'frame'],
  };

  try {
    if (isFirefox) {
      const p = ext.contextMenus.create(details);
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } else {
      ext.contextMenus.create(details, () => {
        void ext.runtime.lastError;
      });
    }
  } catch (e) {}
}

ext.runtime.onInstalled.addListener((details) => {
  ensureMenu();
  if (details && details.reason === 'install') {
    try {
      ext.tabs.create({ url: ext.runtime.getURL(TUTORIAL_PATH) });
    } catch (e) {}
  }
});

if (ext.runtime.onStartup) {
  ext.runtime.onStartup.addListener(ensureMenu);
}

if (ext.commands && ext.commands.onCommand) {
  ext.commands.onCommand.addListener((command, tab) => {
    if (command !== 'toggle-slash') return;
    if (tab && typeof tab.id === 'number') toggleTab(tab.id);
  });
}

if (ext.contextMenus && ext.contextMenus.onClicked) {
  ext.contextMenus.onClicked.addListener((info, tab) => {
    if (info && info.menuItemId === MENU_ID && tab) toggleTab(tab.id);
  });
}

ext.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === MSG_PREFIX + 'state' && sender && sender.tab) {
    setBadge(sender.tab.id, !!msg.active);
  }
  return false;
});

if (ext.tabs && ext.tabs.onUpdated) {
  ext.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo && changeInfo.status === 'loading') setBadge(tabId, false);
  });
}
