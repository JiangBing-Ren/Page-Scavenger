import { createCleaner } from '../../core/src/engine.js';
import { createFreeScore } from '../../core/src/freescore.js';
import {
  SIZE_LEVELS,
  SIZE_LABELS,
  HIT_STOPS,
  HIT_STOP_LABELS,
} from '../../core/src/config.js';

// 沿用旧版存储键，老用户的清理记录不会丢
const STORE_KEY = 'adslash.marks.v1';

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

const storage = {
  async loadMarks() {
    const list = readAll()[location.hostname];
    return Array.isArray(list) ? list : [];
  },
  saveMarks(list) {
    const all = readAll();
    all[location.hostname] = list.slice(-200);
    writeAll(all);
  },
  clearMarks() {
    const all = readAll();
    delete all[location.hostname];
    writeAll(all);
  },
};

let fab = null;

const freeScore = createFreeScore();

const cleaner = createCleaner({
  storage,
  onStateChange(active) {
    freeScore.setActive(active);
    if (!fab) return;
    fab.innerText = active ? '⏹ 退出斩击' : '⚔️ 开启斩击';
    fab.style.background = active ? '#4CAF50' : '#1e1e1e';
  },
  onSlash(info) {
    freeScore.record(info);
  },
});

const config = cleaner.getConfig();

function injectUI() {
  if (!document.body) return;

  fab = document.createElement('button');
  fab.id = 'adslash-fab';
  fab.dataset.adslashUi = '1';
  fab.innerText = '⚔️ 开启斩击';
  Object.assign(fab.style, {
    position: 'fixed',
    right: '20px',
    bottom: '20px',
    zIndex: '2147483648',
    padding: '10px 16px',
    background: '#1e1e1e',
    color: '#fff',
    border: '2px solid #4CAF50',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 'bold',
    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
    transition: 'all 0.2s',
    display: 'block',
  });
  fab.onclick = (e) => {
    e.stopPropagation();
    cleaner.toggle();
  };
  document.body.appendChild(fab);

  window.addEventListener(
    'contextmenu',
    (e) => {
      if (!cleaner.isActive()) return;
      e.preventDefault();
      e.stopPropagation();

      let menu = document.getElementById('adslash-menu');
      if (!menu) {
        menu = document.createElement('div');
        menu.id = 'adslash-menu';
        menu.dataset.adslashUi = '1';
        Object.assign(menu.style, {
          position: 'fixed',
          zIndex: '2147483648',
          background: '#1e1e1e',
          color: '#fff',
          border: '1px solid #444',
          borderRadius: '6px',
          padding: '6px 0',
          boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
          fontSize: '13px',
          display: 'none',
          minWidth: '240px',
          fontFamily: 'sans-serif',
          userSelect: 'none',
        });
        document.body.appendChild(menu);
      }

      menu.innerHTML = '';

      const addItem = (text, onClick) => {
        const item = document.createElement('div');
        item.innerText = text;
        Object.assign(item.style, {
          padding: '8px 16px',
          cursor: 'pointer',
          transition: 'background 0.1s',
        });
        item.onmouseenter = () => (item.style.background = '#333');
        item.onmouseleave = () => (item.style.background = 'transparent');
        item.onclick = () => {
          onClick();
          menu.style.display = 'none';
        };
        menu.appendChild(item);
      };

      addItem(cleaner.isActive() ? '⏹ 退出斩击模式' : '⚔️ 开启斩击模式', () => cleaner.toggle());
      addItem(config.forceMode ? '🎯 自由模式：开启' : '🎯 自由模式：关闭', () => {
        cleaner.setConfig({ forceMode: !config.forceMode });
      });

      addItem(`📐 尺寸挡位：${SIZE_LABELS[config.targetSizeLevel]}`, () => {
        const idx = SIZE_LEVELS.indexOf(config.targetSizeLevel);
        cleaner.setConfig({ targetSizeLevel: SIZE_LEVELS[(idx + 1) % SIZE_LEVELS.length] });
      });

      addItem(`💥 顿感强度：${HIT_STOP_LABELS[config.hitStop]}`, () => {
        const idx = HIT_STOPS.indexOf(config.hitStop);
        cleaner.setConfig({ hitStop: HIT_STOPS[(idx + 1) % HIT_STOPS.length] });
      });

      addItem(
        config.executeOnRelease ? '⏳ 长按模式：开启 (松手炸开)' : '⚡ 长按模式：关闭 (即切)',
        () => cleaner.setConfig({ executeOnRelease: !config.executeOnRelease })
      );

      addItem('↩️ 撤销上一次切除', () => {
        if (!cleaner.undoLast()) alert('没有可撤销的记录了');
      });

      addItem('🧹 清空本域名记录', () => {
        cleaner.clearMarks();
        alert('已清空该网站的拦截记录，刷新后恢复。');
      });

      menu.style.left = e.clientX + 'px';
      menu.style.top = e.clientY + 'px';
      menu.style.display = 'block';
    },
    true
  );

  window.addEventListener(
    'pointerdown',
    (e) => {
      const menu = document.getElementById('adslash-menu');
      if (menu && !menu.contains(e.target)) menu.style.display = 'none';
    },
    true
  );
}

function boot() {
  injectUI();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
