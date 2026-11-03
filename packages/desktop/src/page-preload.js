import { createCleaner } from '../../core/src/engine.js';
import { createFreeScore } from '../../core/src/freescore.js';

const { ipcRenderer } = require('electron');

// 关卡页面自带 runner 和计分，这里再注入一套会打架
const isLevelPage =
  location.protocol === 'file:' && location.pathname.indexOf('/play/levels/') !== -1;

if (!isLevelPage) {
  boot();
} else {
  console.log('[adslash] 关卡页面，跳过程序内置引擎');
}

function boot() {
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

  const freeScore = createFreeScore();

  const cleaner = createCleaner({
    storage,
    onStateChange(active) {
      freeScore.setActive(active);
      ipcRenderer.send('adslash:state', { active, config: cleaner.getConfig() });
    },
    onSlash(info) {
      freeScore.record(info);
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
}
