import {
  DEFAULT_CONFIG,
  SIZE_LEVELS,
  SIZE_LABELS,
  HIT_STOPS,
  HIT_STOP_LABELS,
} from '../../core/src/config.js';
import { createCleaner } from '../../core/src/engine.js';

const ext = typeof browser !== 'undefined' ? browser : typeof chrome !== 'undefined' ? chrome : null;
const isExt = !!(ext && ext.storage && ext.runtime && ext.runtime.id);
const isDesktop = !!(window.desktop && window.desktop.config);

const $ = (id) => document.getElementById(id);

const BASIC_FIELDS = [
  { key: 'targetSizeLevel', label: '尺寸挡位', type: 'select', options: SIZE_LEVELS, labels: SIZE_LABELS },
  { key: 'hitStop', label: '顿感强度', type: 'select', options: HIT_STOPS, labels: HIT_STOP_LABELS, suffix: 'ms' },
  { key: 'executeOnRelease', label: '多刀蓄力（松手炸开）', type: 'toggle', hint: '按住可对同一目标反复叠刀' },
  { key: 'comboCut', label: '连切碎片', type: 'toggle', hint: '切下来的碎片可再次切开' },
  { key: 'allowOversize', label: '允许超大容器', type: 'toggle', hint: '碎片按可见区域裁剪' },
  { key: 'forceMode', label: '自由切割', type: 'toggle', hint: '不限于广告选择器' },
  { key: 'soundEnabled', label: '音效', type: 'toggle' },
  { key: 'soundVolume', label: '音量', type: 'range', min: 0, max: 1, step: 0.05 },
  { key: 'autoApplyMarks', label: '刷新后自动清理', type: 'toggle', hint: '记住切过的元素并自动隐藏' },
];

const ADV_FIELDS = [
  { key: 'trailLength', label: '刀光采样点数', type: 'range', min: 8, max: 60, step: 1 },
  { key: 'trailLifeMs', label: '刀光存活', type: 'range', min: 60, max: 400, step: 10, suffix: 'ms' },
  { key: 'sampleStep', label: '采样步长', type: 'range', min: 1, max: 12, step: 1, suffix: 'px' },
  { key: 'maxAncestorDepth', label: '向上搜索深度', type: 'range', min: 3, max: 30, step: 1 },
  { key: 'maxTargetRatio', label: '目标尺寸上限', type: 'range', min: 0.3, max: 1, step: 0.05 },
  { key: 'pierceRatio', label: '贯穿判定比例', type: 'range', min: 0.2, max: 1, step: 0.05 },
  { key: 'maxCutsPerTarget', label: '单目标最多刀数', type: 'range', min: 1, max: 20, step: 1 },
  { key: 'minCutGap', label: '叠刀最小间距', type: 'range', min: 4, max: 60, step: 2, suffix: 'px' },
  { key: 'cutStepBase', label: '逐刀起始间隔', type: 'range', min: 60, max: 400, step: 10, suffix: 'ms' },
  { key: 'cutStepDecay', label: '逐刀递减系数', type: 'range', min: 0.4, max: 1, step: 0.02 },
  { key: 'cutStepMin', label: '逐刀最小间隔', type: 'range', min: 10, max: 150, step: 5, suffix: 'ms' },
];

let draft = { ...DEFAULT_CONFIG };
let saved = { ...DEFAULT_CONFIG };
let cleaner = null;
let previewing = false;

function hostName() {
  if (isDesktop) return '桌面版';
  if (isExt) return '扩展';
  return '本地';
}

async function loadConfig() {
  if (isDesktop) return (await window.desktop.config.get()) || {};
  if (isExt) {
    try {
      const data = await ext.storage.sync.get('adslash.settings');
      return (data && data['adslash.settings']) || {};
    } catch (e) {
      return {};
    }
  }
  try {
    return JSON.parse(localStorage.getItem('cleanser.config') || '{}');
  } catch (e) {
    return {};
  }
}

async function saveConfig(config) {
  if (isDesktop) return window.desktop.config.set(config);
  if (isExt) {
    await ext.storage.sync.set({ 'adslash.settings': config });
    const tabs = await ext.tabs.query({});
    for (const tab of tabs) {
      if (!tab.id) continue;
      try {
        await ext.tabs.sendMessage(tab.id, { type: 'adslash:setConfig', patch: config });
      } catch (e) {}
    }
    return true;
  }
  localStorage.setItem('cleanser.config', JSON.stringify(config));
  return true;
}

function toast(text, warn) {
  const el = $('toast');
  el.textContent = text || '';
  el.classList.toggle('warn', !!warn);
  if (text) setTimeout(() => { if (el.textContent === text) el.textContent = ''; }, 2200);
}

function markDirty() {
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  $('save').classList.toggle('dirty', dirty);
}

function fieldRow(field) {
  const row = document.createElement('div');
  row.className = 'field';

  const label = document.createElement('div');
  label.className = 'label';
  label.textContent = field.label;
  if (field.hint) {
    const hint = document.createElement('small');
    hint.textContent = field.hint;
    label.appendChild(hint);
  }

  const control = document.createElement('div');
  control.className = 'control';

  if (field.type === 'toggle') {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = draft[field.key] !== false && !!draft[field.key];
    input.addEventListener('change', () => {
      draft[field.key] = input.checked;
      markDirty();
    });
    control.appendChild(input);
    row.dataset.key = field.key;
    row.dataset.kind = 'toggle';
  } else if (field.type === 'select') {
    const select = document.createElement('select');
    for (const option of field.options) {
      const opt = document.createElement('option');
      opt.value = String(option);
      const text = field.labels[option];
      opt.textContent = text != null ? text : String(option);
      select.appendChild(opt);
    }
    select.value = String(draft[field.key]);
    select.addEventListener('change', () => {
      const raw = select.value;
      draft[field.key] = /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw;
      markDirty();
    });
    control.appendChild(select);
    row.dataset.key = field.key;
    row.dataset.kind = 'select';
  } else {
    const input = document.createElement('input');
    input.type = 'range';
    input.min = field.min;
    input.max = field.max;
    input.step = field.step;
    input.value = draft[field.key];

    const value = document.createElement('span');
    value.className = 'value';
    const render = () => {
      const n = Number(draft[field.key]);
      value.textContent = (Number.isFinite(n) ? n : 0) + (field.suffix || '');
    };

    input.addEventListener('input', () => {
      draft[field.key] = Number(input.value);
      render();
      markDirty();
    });

    render();
    control.append(input, value);
    row.dataset.key = field.key;
    row.dataset.kind = 'range';
  }

  row.append(label, control);
  return row;
}

function renderAll() {
  for (const [containerId, fields] of [
    ['basic', BASIC_FIELDS],
    ['adv', ADV_FIELDS],
  ]) {
    const container = $(containerId);
    container.innerHTML = '';
    for (const field of fields) container.appendChild(fieldRow(field));
  }
  markDirty();
}

function syncControls() {
  for (const row of document.querySelectorAll('.field')) {
    const key = row.dataset.key;
    if (!key) continue;
    if (row.dataset.kind === 'toggle') row.querySelector('input').checked = !!draft[key];
    if (row.dataset.kind === 'select') row.querySelector('select').value = String(draft[key]);
    if (row.dataset.kind === 'range') {
      const input = row.querySelector('input');
      input.value = draft[key];
      input.dispatchEvent(new Event('input'));
      input.disabled = false;
    }
  }
  markDirty();
}

function updatePreviewButton() {
  $('preview').textContent = previewing ? '退出试切（Esc）' : '开始试切';
}

function togglePreview() {
  if (!cleaner) {
    cleaner = createCleaner({
      config: { ...draft },
      onStateChange(active) {
        previewing = active;
        updatePreviewButton();
      },
    });
  } else {
    cleaner.setConfig({ ...draft });
  }

  if (previewing) cleaner.deactivate();
  else cleaner.activate();

  updatePreviewButton();
}

async function init() {
  $('host').textContent = '当前：' + hostName();

  const loaded = await loadConfig();
  draft = { ...DEFAULT_CONFIG, ...loaded };
  saved = { ...draft };

  renderAll();

  $('save').addEventListener('click', async () => {
    try {
      await saveConfig({ ...draft });
      saved = { ...draft };
      markDirty();
      toast('已保存');
    } catch (e) {
      toast('保存失败：' + (e && e.message ? e.message : e), true);
    }
  });

  $('reset').addEventListener('click', () => {
    draft = { ...DEFAULT_CONFIG };
    syncControls();
    toast('已还原为默认值，记得保存');
  });

  $('export').addEventListener('click', async () => {
    const json = JSON.stringify(draft, null, 2);
    try {
      await navigator.clipboard.writeText(json);
      toast('配置 JSON 已复制到剪贴板');
    } catch (e) {
      window.prompt('复制下面的 JSON：', json);
    }
  });

  $('preview').addEventListener('click', togglePreview);
}

init();
