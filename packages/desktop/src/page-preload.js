import { createCleaner } from '../../core/src/engine.js';

const { ipcRenderer } = require('electron');

const STORE_KEY = 'adslash.desktop.marks.v1';

function readAll() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function writeAll(all) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(all));
  } catch (e) {}
}

const host = location.hostname || location.protocol || 'local';

const storage = {
  async loadMarks() {
    const list = readAll()[host];
    return Array.isArray(list) ? list : [];
  },
  saveMarks(list) {
    const all = readAll();
    all[host] = list.slice(-200);
    writeAll(all);
  },
  clearMarks() {
    const all = readAll();
    delete all[host];
    writeAll(all);
  },
};

const cleaner = createCleaner({
  storage,
  onStateChange(active) {
    ipcRenderer.send('adslash:state', { active, config: cleaner.getConfig() });
  },
});

function report() {
  ipcRenderer.send('adslash:state', {
    active: cleaner.isActive(),
    config: cleaner.getConfig(),
  });
}

ipcRenderer.on('adslash:cmd', (_event, cmd) => {
  if (cmd === 'toggle') cleaner.toggle();
  else if (cmd === 'activate') cleaner.activate();
  else if (cmd === 'deactivate') cleaner.deactivate();
  report();
});

ipcRenderer.on('adslash:config', (_event, patch) => {
  cleaner.setConfig(patch);
  report();
});

report();

console.log('[adslash] 引擎已注入', host);
