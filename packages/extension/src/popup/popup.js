import {
  SIZE_LEVELS,
  SIZE_LABELS,
  HIT_STOPS,
  HIT_STOP_LABELS,
} from '../../../core/src/config.js';

const ext = typeof browser !== 'undefined' ? browser : chrome;
const MSG = 'adslash:';

const $ = (id) => document.getElementById(id);

let tabId = null;
let supported = false;

function fillSelect(select, values, labels, current) {
  select.innerHTML = '';
  for (const value of values) {
    const opt = document.createElement('option');
    opt.value = String(value);
    opt.textContent = labels[value];
    if (String(value) === String(current)) opt.selected = true;
    select.appendChild(opt);
  }
}

function notice(text) {
  $('notice').textContent = text || '';
}

async function send(type, extra) {
  if (tabId == null) throw new Error('no-tab');
  return ext.tabs.sendMessage(tabId, Object.assign({ type: MSG + type }, extra || {}));
}

function renderState(state) {
  const active = !!(state && state.active);
  const config = (state && state.config) || {};

  const btn = $('toggle');
  btn.textContent = active ? '结束斩击' : '开启斩击';
  btn.classList.toggle('on', active);
  document.body.classList.toggle('inactive', !active);

  $('host').textContent = (state && state.host) || location.hostname || '当前页面';

  fillSelect($('size'), SIZE_LEVELS, SIZE_LABELS, config.targetSizeLevel || 'auto');
  fillSelect($('hitStop'), HIT_STOPS, HIT_STOP_LABELS, config.hitStop == null ? 40 : config.hitStop);

  $('onRelease').checked = !!config.executeOnRelease;
  $('force').checked = !!config.forceMode;
  $('autoMarks').checked = !!config.autoApplyMarks;
  $('oversize').checked = !!config.allowOversize;
  $('comboCut').checked = !!config.comboCut;

  if (state && typeof state.markCount === 'number') {
    notice(`本域名已记录 ${state.markCount} 条清理规则`);
  }
}

function setEnabled(enabled) {
  const controls = document.querySelectorAll('select, input, .actions button, #toggle');
  for (const el of controls) el.disabled = !enabled;
}

function applyConfig(patch) {
  return send('setConfig', { patch })
    .then((state) => {
      if (state) renderState(state);
    })
    .catch(() => notice('设置未能送达，请刷新页面后重试'));
}

async function init() {
  let tab = null;
  try {
    const tabs = await ext.tabs.query({ active: true, currentWindow: true });
    tab = tabs && tabs[0];
  } catch (e) {}

  if (!tab || typeof tab.id !== 'number') {
    setEnabled(false);
    notice('无法读取当前标签页');
    return;
  }

  tabId = tab.id;

  try {
    const state = await send('getState');
    supported = true;
    renderState(state);
  } catch (e) {
    setEnabled(false);
    $('host').textContent = tab.url ? new URL(tab.url).protocol + '//' : '当前页面';
    notice('此页面不支持注入（浏览器内部页 / 扩展页 / PDF）。请打开普通网页再试。');
  }

  $('toggle').addEventListener('click', async () => {
    try {
      renderState(await send('toggle'));
    } catch (e) {
      notice('切换失败，请刷新页面');
    }
  });

  $('size').addEventListener('change', (e) => applyConfig({ targetSizeLevel: e.target.value }));
  $('hitStop').addEventListener('change', (e) => applyConfig({ hitStop: Number(e.target.value) }));
  $('onRelease').addEventListener('change', (e) =>
    applyConfig({ executeOnRelease: e.target.checked })
  );
  $('force').addEventListener('change', (e) => applyConfig({ forceMode: e.target.checked }));
  $('autoMarks').addEventListener('change', (e) =>
    applyConfig({ autoApplyMarks: e.target.checked })
  );
  $('oversize').addEventListener('change', (e) =>
    applyConfig({ allowOversize: e.target.checked })
  );
  $('comboCut').addEventListener('change', (e) =>
    applyConfig({ comboCut: e.target.checked })
  );

  $('undo').addEventListener('click', async () => {
    try {
      const res = await send('undo');
      notice(res && res.ok ? '已撤销上一次切除' : '没有可撤销的记录');
      renderState(await send('getState'));
    } catch (e) {
      notice('撤销失败');
    }
  });

  $('clear').addEventListener('click', async () => {
    try {
      await send('clearMarks');
      notice('已清空本域名的清理记录');
      renderState(await send('getState'));
    } catch (e) {
      notice('清空失败');
    }
  });

  $('tutorial').addEventListener('click', () => {
    ext.tabs.create({ url: ext.runtime.getURL('play/levels/index.html') });
    window.close();
  });

  if (!supported) setEnabled(false);
}

init();
