import { createCleaner } from '../../core/src/engine.js';
import { createFreeScore } from '../../core/src/freescore.js';

const ext = typeof browser !== 'undefined' ? browser : chrome;

const SETTINGS_KEY = 'adslash.settings';
const MSG_PREFIX = 'adslash:';

const marksKey = () => 'adslash.marks.' + location.hostname;

let cleaner = null;
const freeScore = createFreeScore();
let currentSettings = {};

function createStorage() {
  return {
    async loadMarks() {
      try {
        const key = marksKey();
        const data = await ext.storage.local.get(key);
        const list = data && data[key];
        return Array.isArray(list) ? list : [];
      } catch (e) {
        return [];
      }
    },
    saveMarks(list) {
      try {
        ext.storage.local.set({ [marksKey()]: list });
      } catch (e) {}
    },
    clearMarks() {
      try {
        ext.storage.local.remove(marksKey());
      } catch (e) {}
    },
  };
}

function reportState(active) {
  try {
    const p = ext.runtime.sendMessage({ type: MSG_PREFIX + 'state', active });
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch (e) {}
}

function ensure() {
  if (cleaner) return cleaner;

  cleaner = createCleaner({
    storage: createStorage(),
    soundAssets: {
      shellDrop: ext.runtime.getURL('assets/shell-drop.mp3'),
    },
    onStateChange(active) {
      freeScore.setActive(active);
      reportState(active);
    },
    onSlash(info) {
      freeScore.record(info);
    },
  });

  if (Object.keys(currentSettings).length) cleaner.setConfig(currentSettings);
  return cleaner;
}

async function loadSettings() {
  try {
    const data = await ext.storage.sync.get(SETTINGS_KEY);
    const saved = data && data[SETTINGS_KEY];
    if (saved && typeof saved === 'object') {
      currentSettings = saved;
      if (cleaner) cleaner.setConfig(saved);
    }
  } catch (e) {}
}

function persistSettings(patch) {
  currentSettings = Object.assign({}, currentSettings, patch);
  try {
    const p = ext.storage.sync.set({ [SETTINGS_KEY]: currentSettings });
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch (e) {}
}

function statePayload(c) {
  return {
    active: c.isActive(),
    config: c.getConfig(),
    markCount: c.getMarkCount(),
    slashCount: c.getSlashCount(),
    host: location.hostname,
  };
}

// document_start 时 body 还不存在，先建引擎再等设置，激活动作由宿主触发
ensure();
loadSettings();

ext.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return;
  if (typeof msg.type !== 'string' || msg.type.indexOf(MSG_PREFIX) !== 0) return;

  const c = ensure();

  switch (msg.type) {
    case MSG_PREFIX + 'toggle':
      c.toggle();
      sendResponse(statePayload(c));
      break;

    case MSG_PREFIX + 'activate':
      c.activate();
      sendResponse(statePayload(c));
      break;

    case MSG_PREFIX + 'deactivate':
      c.deactivate();
      sendResponse(statePayload(c));
      break;

    case MSG_PREFIX + 'getState':
      sendResponse(statePayload(c));
      break;

    case MSG_PREFIX + 'setConfig':
      c.setConfig(msg.patch);
      persistSettings(msg.patch || {});
      sendResponse(statePayload(c));
      break;

    case MSG_PREFIX + 'undo':
      sendResponse({ ok: c.undoLast() });
      break;

    case MSG_PREFIX + 'clearMarks':
      c.clearMarks();
      sendResponse({ ok: true, markCount: c.getMarkCount() });
      break;

    default:
      return;
  }

  return true;
});
