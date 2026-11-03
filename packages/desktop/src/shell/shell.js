import {
  SIZE_LEVELS,
  SIZE_LABELS,
  HIT_STOPS,
  HIT_STOP_LABELS,
} from '../../../core/src/config.js';

const $ = (id) => document.getElementById(id);
const api = window.desktop;

const toolbar = $('toolbar');
const addr = $('addr');
const toggleBtn = $('toggle');
const statusEl = $('status');
const sizeSel = $('size');
const hitStopSel = $('hitStop');
const onRelease = $('onRelease');
const force = $('force');

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

function prettyUrl(url) {
  if (!url) return '';
  if (url.startsWith('file://')) return '';
  return url;
}

function reportHeight() {
  const height = Math.ceil(toolbar.getBoundingClientRect().height);
  api.ui.setToolbarHeight(height);
}

new ResizeObserver(reportHeight).observe(toolbar);
reportHeight();

// 导航
addr.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  api.nav.go(addr.value);
  addr.blur();
});

addr.addEventListener('focus', () => addr.select());

$('back').addEventListener('click', () => api.nav.back());
$('reload').addEventListener('click', () => api.nav.reload());
$('home').addEventListener('click', () => api.nav.home());
$('levels').addEventListener('click', () => api.nav.levels());
$('guide').addEventListener('click', () => api.ui.openGuide());
toggleBtn.addEventListener('click', () => api.game.toggle());

// 设置
fillSelect(sizeSel, SIZE_LEVELS, SIZE_LABELS, 'auto');
fillSelect(hitStopSel, HIT_STOPS, HIT_STOP_LABELS, 40);

sizeSel.addEventListener('change', () => api.game.setConfig({ targetSizeLevel: sizeSel.value }));
hitStopSel.addEventListener('change', () => api.game.setConfig({ hitStop: Number(hitStopSel.value) }));
onRelease.addEventListener('change', () =>
  api.game.setConfig({ executeOnRelease: onRelease.checked })
);
force.addEventListener('change', () => api.game.setConfig({ forceMode: force.checked }));

const oversize = $('oversize');
oversize.addEventListener('change', () =>
  api.game.setConfig({ allowOversize: oversize.checked })
);

const comboCut = $('comboCut');
comboCut.addEventListener('change', () => api.game.setConfig({ comboCut: comboCut.checked }));

// 主进程推送
api.on.nav((patch) => {
  if (patch.url !== undefined && document.activeElement !== addr) addr.value = prettyUrl(patch.url);
  if (patch.title) document.title = patch.title + ' — 页面清道夫';
  if (patch.loading !== undefined) document.body.classList.toggle('loading', !!patch.loading);
  if (patch.error) statusEl.textContent = '加载失败：' + patch.error;
  else if (patch.error === '') statusEl.textContent = '';
});

api.on.game((state) => {
  const active = !!(state && state.active);
  toggleBtn.classList.toggle('on', active);
  toggleBtn.textContent = active ? '结束斩击' : '开始斩击';

  const config = (state && state.config) || {};
  if (config.targetSizeLevel && sizeSel.value !== config.targetSizeLevel) {
    sizeSel.value = config.targetSizeLevel;
  }
  if (config.hitStop != null && hitStopSel.value !== String(config.hitStop)) {
    hitStopSel.value = String(config.hitStop);
  }
  onRelease.checked = !!config.executeOnRelease;
  force.checked = !!config.forceMode;
  oversize.checked = !!config.allowOversize;
  comboCut.checked = !!config.comboCut;
});

addr.focus();
