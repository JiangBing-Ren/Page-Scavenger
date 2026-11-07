import {
  DEFAULT_CONFIG,
  SIZE_LEVELS,
  SIZE_LABELS,
  HIT_STOPS,
  HIT_STOP_LABELS,
  BLACKHOLE_STYLES,
  BLACKHOLE_STYLE_LABELS,
  CANNON_BREAK_STYLES,
  CANNON_BREAK_STYLE_LABELS,
  BLADE_STYLES,
  BLADE_STYLE_LABELS,
  LASER_STYLES,
  LASER_STYLE_LABELS,
  SFX_PRESETS,
  SFX_PRESET_LABELS,
  SFX_SOURCES,
  SFX_SOURCE_LABELS,
  SFX_PROFILE_MAX,
  SFX_WEAPON,
  DUAL_SFX,
} from '../../core/src/config.js';
import {
  capOf,
  captureSfxValues,
  captureWeaponValues,
  restoreWeaponSfx,
  applyProfileTo,
  pickSfxSource,
} from '../../core/src/sfxprofile.js';
import { createCleaner } from '../../core/src/engine.js';
import { sampleUrls, sampleBytes, SAMPLE_ASSETS, SYNTH_SFX } from '../../core/src/sound.js';
import { WEAPONS, WEAPON_GROUPS } from '../../core/src/weapons.js';

const ext = typeof browser !== 'undefined' ? browser : typeof chrome !== 'undefined' ? chrome : null;
const isExt = !!(ext && ext.storage && ext.runtime && ext.runtime.id);
const isDesktop = !!(window.desktop && window.desktop.config);

const $ = (id) => document.getElementById(id);

const BASIC_FIELDS = [
  { key: 'targetSizeLevel', label: '尺寸挡位', type: 'select', options: SIZE_LEVELS, labels: SIZE_LABELS },
  { key: 'hitStop', label: '顿感强度', type: 'select', options: HIT_STOPS, labels: HIT_STOP_LABELS, suffix: 'ms' },
  { key: 'executeOnRelease', label: '长按模式', type: 'toggle', hint: '按住可对同一目标反复叠刀；黑洞按住时跟随光标' },
  { key: 'comboCut', label: '连切碎片（刀）', type: 'toggle', hint: '只有刀切下的碎片能再次切开，炮/黑洞/枪械的碎块不可再切' },
  { key: 'allowOversize', label: '允许超大容器', type: 'toggle', hint: '碎片按可见区域裁剪' },
  { key: 'forceMode', label: '自由模式', type: 'toggle', hint: '不限于广告选择器，任意元素都能切' },
  { key: 'soundEnabled', label: '音效', type: 'toggle' },
  { key: 'soundVolume', label: '总音量', type: 'range', min: 0, max: 1, step: 0.05 },
  { key: 'autoApplyMarks', label: '刷新后自动清理', type: 'toggle', hint: '记住切过的元素并自动隐藏' },
];

// 高级参数按武器分一级分类，每个武器下面再按用途分二级
const ADV_GROUPS = [
  ['blade', '刀', [
    ['multicut', '多刀'],
    ['target', '判定'],
    ['trail', '刀光'],
    ['sfx', '音效'],
  ]],
  ['cannon', '炮', [
    ['blast', '爆破'],
    ['crack', '裂缝'],
    ['sfx', '音效'],
  ]],
  ['revolver', '左轮', [
    ['shot', '射击与弹仓'],
    ['sfx', '音效'],
  ]],
  ['machinegun', '机枪', [
    ['shot', '射击'],
    ['sfx', '音效'],
  ]],
  ['laser', '激光炮', [
    ['beam', '光束'],
    ['hit', '判定'],
    ['sfx', '音效'],
  ]],
  ['blackhole', '黑洞', [
    ['gravity', '引力'],
    ['devour', '吞噬'],
    ['sfx', '音效'],
  ]],
];

const ADV_FIELDS = [
  // 刀 · 多刀
  { key: 'maxCutsPerTarget', label: '单目标最多刀数', type: 'range', min: 1, max: 20, step: 1, group: 'blade', sub: 'multicut' },
  { key: 'minCutGap', label: '叠刀最小间距', type: 'range', min: 4, max: 60, step: 2, suffix: 'px', group: 'blade', sub: 'multicut' },
  { key: 'cutStepBase', label: '逐刀起始间隔', type: 'range', min: 60, max: 400, step: 10, suffix: 'ms', group: 'blade', sub: 'multicut' },
  { key: 'cutStepDecay', label: '逐刀递减系数', type: 'range', min: 0.4, max: 1, step: 0.02, group: 'blade', sub: 'multicut' },
  { key: 'cutStepMin', label: '逐刀最小间隔', type: 'range', min: 10, max: 150, step: 5, suffix: 'ms', group: 'blade', sub: 'multicut' },
  // 刀 · 判定
  { key: 'maxAncestorDepth', label: '向上搜索深度', type: 'range', min: 3, max: 30, step: 1, group: 'blade', sub: 'target' },
  { key: 'maxTargetRatio', label: '目标尺寸上限', type: 'range', min: 0.3, max: 1, step: 0.05, group: 'blade', sub: 'target' },
  { key: 'pierceRatio', label: '贯穿判定比例', type: 'range', min: 0.2, max: 1, step: 0.05, group: 'blade', sub: 'target' },
  { key: 'sampleStep', label: '采样步长', type: 'range', min: 1, max: 12, step: 1, suffix: 'px', group: 'blade', sub: 'target' },
  // 刀 · 刀光
  { key: 'bladeStyle', label: '斩击形态', type: 'select', options: BLADE_STYLES, labels: BLADE_STYLE_LABELS, group: 'blade', sub: 'trail' },
  { key: 'bladeFxDurationMs', label: '白热序列时长', type: 'range', min: 200, max: 1700, step: 50, suffix: 'ms', group: 'blade', sub: 'trail', hint: '仅「白热刃口 Slash wipe」生效；1700ms 接近 pixelfx 原版节奏' },
  { key: 'trailLength', label: '刀光采样点数', type: 'range', min: 8, max: 60, step: 1, group: 'blade', sub: 'trail' },
  { key: 'trailLifeMs', label: '刀光存活', type: 'range', min: 60, max: 400, step: 10, suffix: 'ms', group: 'blade', sub: 'trail' },
  // 刀 · 音效
  { sfx: 'bladeSwing', label: '第1刀', group: 'blade', sub: 'sfx' },
  { sfx: 'bladeSwing2', label: '第2刀', group: 'blade', sub: 'sfx' },
  { sfx: 'bladeSwing3', label: '第3刀', group: 'blade', sub: 'sfx' },
  { sfx: 'bladeSwing4', label: '第4刀', group: 'blade', sub: 'sfx' },
  { sfx: 'bladeCut', label: '切入', group: 'blade', sub: 'sfx' },
  { sfx: 'bladeBreak', label: '碎裂', group: 'blade', sub: 'sfx' },
  { sfx: 'bladeFinish', label: '多刀最后一击', group: 'blade', sub: 'sfx' },

  // 炮 · 爆破
  { key: 'cannonRadius', label: '爆破半径', type: 'range', min: 60, max: 320, step: 10, suffix: 'px', group: 'cannon', sub: 'blast' },
  { key: 'weaponCooldown', label: '开火间隔', type: 'range', min: 60, max: 600, step: 10, suffix: 'ms', group: 'cannon', sub: 'blast' },
  { key: 'blastHoleScale', label: '洞口大小', type: 'range', min: 0.4, max: 1.2, step: 0.05, group: 'cannon', sub: 'blast' },
  { key: 'blastHoleHold', label: '洞口停留', type: 'range', min: 0, max: 1500, step: 50, suffix: 'ms', group: 'cannon', sub: 'blast' },
  // 炮 · 裂缝
  { key: 'cannonBreakStyle', label: '破碎形态', type: 'select', options: CANNON_BREAK_STYLES, labels: CANNON_BREAK_STYLE_LABELS, group: 'cannon', sub: 'crack' },
  { key: 'shatterDurationMs', label: '玻璃碎裂时长', type: 'range', min: 600, max: 2800, step: 100, suffix: 'ms', group: 'cannon', sub: 'crack', hint: '仅「玻璃碎裂 Shatter wipe」生效；2800ms 接近原版节奏' },
  { key: 'crackWidth', label: '粗细', type: 'range', min: 0.04, max: 0.3, step: 0.01, group: 'cannon', sub: 'crack' },
  { key: 'crackLength', label: '长短', type: 'range', min: 0.3, max: 2.5, step: 0.1, group: 'cannon', sub: 'crack' },
  { key: 'crackStartWidth', label: '起点宽度', type: 'range', min: 0.3, max: 2, step: 0.1, group: 'cannon', sub: 'crack' },
  { key: 'crackEndWidth', label: '末端宽度', type: 'range', min: 0.05, max: 1, step: 0.05, group: 'cannon', sub: 'crack' },
  // 炮 · 音效
  { sfx: 'cannonFire', label: '开火', group: 'cannon', sub: 'sfx' },
  { sfx: 'cannonCrack', label: '裂缝', group: 'cannon', sub: 'sfx' },
  { sfx: 'cannonBreak', label: '爆散', group: 'cannon', sub: 'sfx' },

  // 左轮 · 射击与弹仓
  { key: 'revolverHoleRadius', label: '弹孔大小', type: 'range', min: 10, max: 90, step: 2, suffix: 'px', group: 'revolver', sub: 'shot' },
  { key: 'revolverCooldown', label: '射击间隔', type: 'range', min: 120, max: 600, step: 10, suffix: 'ms', group: 'revolver', sub: 'shot' },
  { key: 'revolverChambers', label: '弹仓容量', type: 'range', min: 1, max: 12, step: 1, group: 'revolver', sub: 'shot' },
  { key: 'revolverReloadMs', label: '换弹时间', type: 'range', min: 200, max: 2500, step: 50, suffix: 'ms', group: 'revolver', sub: 'shot' },
  { key: 'shellCasingsEnabled', label: '抛壳', type: 'toggle', group: 'revolver', sub: 'shot' },
  // 左轮 · 音效
  { sfx: 'revolverFire', label: '开火', group: 'revolver', sub: 'sfx' },
  { sfx: 'revolverHit', label: '弹孔', group: 'revolver', sub: 'sfx' },
  { sfx: 'reload', label: '换弹', group: 'revolver', sub: 'sfx' },
  { sfx: 'shellDrop', label: '弹壳落地', group: 'revolver', sub: 'sfx' },

  // 机枪 · 射击
  { key: 'machinegunHoleRadius', label: '弹孔大小', type: 'range', min: 6, max: 60, step: 2, suffix: 'px', group: 'machinegun', sub: 'shot' },
  { key: 'machinegunCooldown', label: '射速间隔', type: 'range', min: 30, max: 300, step: 10, suffix: 'ms', group: 'machinegun', sub: 'shot' },
  { key: 'machinegunSpread', label: '散布', type: 'range', min: 0, max: 40, step: 2, suffix: 'px', group: 'machinegun', sub: 'shot' },
  { key: 'muzzleFlashEnabled', label: '枪口火光', type: 'toggle', group: 'machinegun', sub: 'shot' },
  // 机枪 · 音效
  { sfx: 'machinegunFire', label: '开火', group: 'machinegun', sub: 'sfx' },
  { sfx: 'machinegunHit', label: '弹着', group: 'machinegun', sub: 'sfx' },

  // 激光炮 · 光束
  { key: 'laserStyle', label: '视觉形态', type: 'select', options: LASER_STYLES, labels: LASER_STYLE_LABELS, group: 'laser', sub: 'beam' },
  { key: 'laserWidth', label: '满蓄力光柱宽', type: 'range', min: 4, max: 60, step: 2, suffix: 'px', group: 'laser', sub: 'beam' },
  { key: 'laserColumnMs', label: '光柱动画时长', type: 'range', min: 300, max: 2000, step: 50, suffix: 'ms', group: 'laser', sub: 'beam' },
  // 激光炮 · 判定
  { key: 'laserChargeMs', label: '满蓄力时长', type: 'range', min: 200, max: 2500, step: 50, suffix: 'ms', group: 'laser', sub: 'hit' },
  { key: 'laserOverchargeMs', label: '过量蓄力时长', type: 'range', min: 200, max: 3000, step: 50, suffix: 'ms', group: 'laser', sub: 'hit', hint: '满蓄力后继续按住多久达到宽度上限（满蓄力的 3 倍）' },
  { key: 'laserCooldownMs', label: '发射冷却', type: 'range', min: 0, max: 1500, step: 50, suffix: 'ms', group: 'laser', sub: 'hit' },
  { key: 'laserRange', label: '满蓄力射程', type: 'range', min: 200, max: 3000, step: 100, suffix: 'px', group: 'laser', sub: 'hit' },
  { key: 'laserMaxTargets', label: '贯穿上限', type: 'range', min: 1, max: 20, step: 1, suffix: '个', group: 'laser', sub: 'hit' },
  { key: 'laserBurnThreshold', label: '烧毁阈值', type: 'range', min: 0.1, max: 1, step: 0.05, group: 'laser', sub: 'hit', hint: '烧蚀面积占比达到该值时元素整体消失并结算' },
  { key: 'laserBurnIntensity', label: '灼烧程度', type: 'range', min: 0.3, max: 2, step: 0.1, group: 'laser', sub: 'hit', hint: '影响焦边宽度、边缘破碎度与余温时长；越大，贯穿口外围的焦痕越明显' },
  // 激光炮 · 音效
  { sfx: 'laserCharge', label: '蓄力', group: 'laser', sub: 'sfx' },
  { sfx: 'laserFire', label: '发射', group: 'laser', sub: 'sfx' },
  { sfx: 'laserOverFire', label: '过量发射', group: 'laser', sub: 'sfx' },
  { sfx: 'laserHit', label: '烧蚀', group: 'laser', sub: 'sfx' },
  { sfx: 'laserBeam', label: '蓄力嗡鸣（兜底）', group: 'laser', sub: 'sfx' },

  // 黑洞 · 引力
  { key: 'blackholeStyle', label: '视觉形态', type: 'select', options: BLACKHOLE_STYLES, labels: BLACKHOLE_STYLE_LABELS, group: 'blackhole', sub: 'gravity' },
  { key: 'blackholeRadius', label: '初始大小', type: 'range', min: 40, max: 400, step: 10, suffix: 'px', group: 'blackhole', sub: 'gravity' },
  { key: 'blackholeFieldRatio', label: '引力场', type: 'range', min: 0.1, max: 1, step: 0.05, suffix: '×R', group: 'blackhole', sub: 'gravity' },
  { key: 'blackholeCaptureRatio', label: '可吸面积比', type: 'range', min: 1, max: 3, step: 0.05, group: 'blackhole', sub: 'gravity' },
  { key: 'blackholeCooldown', label: '放置间隔', type: 'range', min: 120, max: 2000, step: 20, suffix: 'ms', group: 'blackhole', sub: 'gravity' },
  { key: 'blackholeDurationMs', label: '存活时长', type: 'range', min: 600, max: 6000, step: 100, suffix: 'ms', group: 'blackhole', sub: 'gravity' },
  // 黑洞 · 吞噬
  { key: 'blackholeTearRatio', label: '撕裂阈值', type: 'range', min: 0.3, max: 1.3, step: 0.05, group: 'blackhole', sub: 'devour' },
  { key: 'blackholeGrowEfficiency', label: '成长效率', type: 'range', min: 0, max: 0.2, step: 0.005, group: 'blackhole', sub: 'devour' },
  { key: 'blackholeMaxAreaRatio', label: '面积上限', type: 'range', min: 0.1, max: 1, step: 0.01, group: 'blackhole', sub: 'devour' },
  // 黑洞 · 音效
  { sfx: 'blackholeOpen', label: '生成', group: 'blackhole', sub: 'sfx' },
  { sfx: 'blackholeHum', label: '吸附', group: 'blackhole', sub: 'sfx' },
  { sfx: 'blackholeEat', label: '吞噬', group: 'blackhole', sub: 'sfx' },
];

// sfxProfiles 是嵌套结构，浅拷贝会让新建方案污染 DEFAULT_CONFIG，必须单独深拷贝
function cloneConfig(src) {
  return {
    ...src,
    sfxProfiles: JSON.parse(JSON.stringify((src && src.sfxProfiles) || [])),
  };
}

let draft = cloneConfig(DEFAULT_CONFIG);
let saved = cloneConfig(DEFAULT_CONFIG);
let advFilter = 'all';
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
  try {
    if (isDesktop) return await window.desktop.config.set(config);
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
  } catch (e) {
    // chrome.storage.sync 单键上限 8KB。方案只存数值（4 套约 4KB），
    // 音频文件放在 assets 目录、不进配置，所以正常不会触发；真触发就明说原因。
    const msg = e && e.message ? e.message : '未知错误';
    toast('保存失败：' + msg, true);
    return false;
  }
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

// ---- 音效方案：多套玩家自己的配置，只存数值（来源 + 两套音量），不含音频数据 ----

function activeProfile() {
  return (draft.sfxProfiles || []).find((p) => p.name === draft.sfxProfileActive) || null;
}

// 应用整套方案：先把音效键复位到默认，再叠加方案里保存的值
function applyProfile(name) {
  const prof = (draft.sfxProfiles || []).find((p) => p.name === name);
  if (!prof) return;
  applyProfileTo(draft, prof);
  renderAll();
  markDirty();
}

function overwriteProfile() {
  const prof = activeProfile();
  if (!prof) return;
  prof.values = captureSfxValues(draft);
  toast('已覆盖方案「' + prof.name + '」');
  markDirty();
}

// 方案命名：动态 dialog，避免依赖 HTML 里预置节点
function askProfileName(defaultName, onOk) {
  const dlg = document.createElement('dialog');
  const form = document.createElement('form');
  form.method = 'dialog';

  const title = document.createElement('h3');
  title.textContent = '新建音效方案';

  const input = document.createElement('input');
  input.type = 'text';
  input.value = defaultName;
  input.maxLength = 16;

  const actions = document.createElement('div');
  actions.className = 'dialog-actions';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = '取消';
  const ok = document.createElement('button');
  ok.type = 'submit';
  ok.className = 'primary';
  ok.textContent = '创建';
  actions.append(cancel, ok);

  form.append(title, input, actions);
  dlg.appendChild(form);
  document.body.appendChild(dlg);

  const close = () => {
    if (dlg.parentNode) dlg.parentNode.removeChild(dlg);
  };
  cancel.addEventListener('click', close);
  dlg.addEventListener('close', close);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = (input.value || '').trim();
    if (!name) return;
    if (onOk(name) === false) return;
    close();
  });

  if (typeof dlg.showModal === 'function') dlg.showModal();
  else dlg.setAttribute('open', '');
  input.select();
}

function newProfile() {
  const profiles = draft.sfxProfiles || (draft.sfxProfiles = []);
  if (profiles.length >= SFX_PROFILE_MAX) {
    toast('方案最多 ' + SFX_PROFILE_MAX + ' 套，请先覆盖现有方案', true);
    return;
  }
  askProfileName('方案 ' + (profiles.length + 1), (name) => {
    if (profiles.some((p) => p.name === name)) {
      toast('名字重复了', true);
      return false;
    }
    profiles.push({ name, values: captureSfxValues(draft) });
    draft.sfxProfileActive = name;
    renderAll();
    markDirty();
    toast('已新建方案「' + name + '」');
    return true;
  });
}

// 常用区的「音效预设」行：方案下拉 + 新建 + 覆盖（这里只管方案，不放试听/重置）
function sfxProfileRow() {
  const row = document.createElement('div');
  row.className = 'field';

  const label = document.createElement('div');
  label.className = 'label';
  label.textContent = '音效预设';
  const hint = document.createElement('small');
  hint.textContent = '保存多套音效方案，切换即应用；最多 ' + SFX_PROFILE_MAX + ' 套';
  label.appendChild(hint);

  const control = document.createElement('div');
  control.className = 'control';

  const select = document.createElement('select');
  for (const p of draft.sfxProfiles || []) {
    const opt = document.createElement('option');
    opt.value = p.name;
    opt.textContent = p.name;
    select.appendChild(opt);
  }
  select.value = draft.sfxProfileActive;
  select.addEventListener('change', () => applyProfile(select.value));
  control.appendChild(select);

  const newBtn = document.createElement('button');
  newBtn.type = 'button';
  newBtn.className = 'reset-field';
  newBtn.textContent = '新建';
  newBtn.title = '把当前音效配置另存为新方案';
  newBtn.addEventListener('click', newProfile);
  control.appendChild(newBtn);

  const overBtn = document.createElement('button');
  overBtn.type = 'button';
  overBtn.className = 'reset-field';
  overBtn.textContent = '覆盖';
  overBtn.title = '用当前音效配置覆盖选中方案';
  overBtn.addEventListener('click', () => {
    const prof = activeProfile();
    if (!prof) return;
    if (typeof confirm === 'function' && !confirm('用当前设置覆盖方案「' + prof.name + '」？')) return;
    overwriteProfile();
  });
  control.appendChild(overBtn);

  row.append(label, control);
  return row;
}

// 武器「音效」标题旁：该武器用哪套来源 + 保存进当前方案（不放新建，避免与方案管理重复）
function weaponSfxControls(weaponKey) {
  const wrap = document.createElement('div');
  wrap.className = 'subgroup-controls';

  const sourceKey = weaponKey + 'SoundSource';

  const select = document.createElement('select');
  for (const mode of SFX_PRESETS) {
    const opt = document.createElement('option');
    opt.value = mode;
    opt.textContent = SFX_PRESET_LABELS[mode];
    select.appendChild(opt);
  }
  select.value = draft[sourceKey] || 'sample';
  select.title = '这把武器用哪套音效';
  select.addEventListener('change', () => {
    draft[sourceKey] = select.value;
    // 切档位 = 从当前方案重新展开，未保存的改动会被方案里的值覆盖
    restoreWeaponSfx(draft, weaponKey, (activeProfile() || {}).values);
    draft[sourceKey] = select.value;
    renderAdvanced();
    markDirty();
  });
  wrap.appendChild(select);

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'reset-field';
  saveBtn.textContent = '保存';
  saveBtn.title = '把这把武器的音效设置保存进当前方案';
  saveBtn.addEventListener('click', () => {
    const prof = activeProfile();
    if (!prof) return;
    prof.values = Object.assign({}, prof.values, captureWeaponValues(draft, weaponKey));
    prof.values[sourceKey] = draft[sourceKey];
    toast('已保存到方案「' + prof.name + '」');
    markDirty();
  });
  wrap.appendChild(saveBtn);

  return wrap;
}

/**
 * 音效行：来源下拉 + 当前那一套的音量 + 试听 + 还原。
 * 两套音量各自独立保存（sfx<Name>Sample / sfx<Name>Synth），UI 只显示当前这套——
 * 采样与合成的响度基准不同，共用同一个值必然有一边调不准。
 */
function sfxRow(field) {
  const name = field.sfx;
  const cap = capOf(name);
  const dual = DUAL_SFX.indexOf(name) !== -1;
  // 判断「这个音效有没有采样实现」要用 SAMPLE_ASSETS（静态清单，只登记真实存在的文件）。
  // sampleUrls 是函数、要传 getUrl 才知道 URL，拿它当对象用会恒为 undefined，
  // 结果所有音效都被当成「只有合成」，下拉恒显示合成、音量恒读合成那套。
  const hasSample = !!SAMPLE_ASSETS[name];
  const hasSynth = SYNTH_SFX.indexOf(name) !== -1;
  const weapon = SFX_WEAPON[name] || '';
  // 与运行时共用同一份判断：想走的那套不存在时会回落，不会显示成「合成」却实际静音
  const source = pickSfxSource(draft, name, hasSample, hasSynth);
  const volKey = dual ? 'sfx' + cap + (source === 'synth' ? 'Synth' : 'Sample') : 'sfx' + cap;

  const row = document.createElement('div');
  row.className = 'field';
  row.dataset.key = volKey;
  row.dataset.kind = 'range';

  const label = document.createElement('div');
  label.className = 'label';
  label.textContent = field.label;
  const note = document.createElement('small');
  if (!hasSample) note.textContent = dual ? '采样缺失，已回落合成' : '仅合成';
  else if (!hasSynth) note.textContent = '仅采样';
  if (note.textContent) label.appendChild(note);

  const control = document.createElement('div');
  control.className = 'control';

  const select = document.createElement('select');
  for (const s of SFX_SOURCES) {
    const opt = document.createElement('option');
    opt.value = s;
    opt.textContent = SFX_SOURCE_LABELS[s];
    select.appendChild(opt);
  }
  select.value = source;
  // 只有一套实现的槽位置灰；双实现始终可改——改了会把该武器自动切到「自定义」
  select.disabled = !dual;
  select.title = !dual
    ? '此音效只有一套实现'
    : '切换此音效的来源（会把该武器自动切到自定义）';
  select.addEventListener('change', () => {
    draft['sfx' + cap + 'Source'] = select.value;
    if (weapon) draft[weapon + 'SoundSource'] = 'custom';
    markDirty();
    renderAdvanced();
  });
  control.appendChild(select);

  const input = document.createElement('input');
  input.type = 'range';
  input.min = 0;
  input.max = 2;
  input.step = 0.05;
  input.value = draft[volKey];

  const value = document.createElement('span');
  value.className = 'value';
  const renderValue = () => {
    const n = Number(draft[volKey]);
    value.textContent = (Number.isFinite(n) ? n : 0).toFixed(2);
  };
  input.addEventListener('input', () => {
    draft[volKey] = Number(input.value);
    renderValue();
    markDirty();
  });
  renderValue();
  control.append(input, value);

  const playBtn = document.createElement('button');
  playBtn.type = 'button';
  playBtn.className = 'reset-field';
  playBtn.title = '试听（按当前预设/来源实际会响的那一套）';
  playBtn.textContent = '▶';
  playBtn.addEventListener('click', () => {
    ensureCleaner().setConfig({ ...draft });
    ensureCleaner().playSfx(name);
  });
  control.appendChild(playBtn);

  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'reset-field';
  resetBtn.title = '还原此项为默认值';
  resetBtn.textContent = '↺';
  resetBtn.addEventListener('click', () => {
    draft[volKey] = DEFAULT_CONFIG[volKey];
    if (dual) draft['sfx' + cap + 'Source'] = DEFAULT_CONFIG['sfx' + cap + 'Source'];
    renderAdvanced();
  });
  control.appendChild(resetBtn);

  row.append(label, control);
  return row;
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

  // 音效项加一个试听按钮，避免靠猜
  if (field.key.indexOf('sfx') === 0) {
    const playBtn = document.createElement('button');
    playBtn.type = 'button';
    playBtn.className = 'reset-field';
    playBtn.title = '试听';
    playBtn.textContent = '▶';
    playBtn.addEventListener('click', () => {
      const raw = field.key.slice(3);
      const voice = raw.charAt(0).toLowerCase() + raw.slice(1);
      ensureCleaner().setConfig({ ...draft });
      ensureCleaner().playSfx(voice);
    });
    control.appendChild(playBtn);
  }

  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'reset-field';
  resetBtn.title = '还原此项为默认值';
  resetBtn.textContent = '↺';
  resetBtn.addEventListener('click', () => {
    draft[field.key] = DEFAULT_CONFIG[field.key];
    syncControls();
  });
  control.appendChild(resetBtn);

  row.append(label, control);
  return row;
}

function renderWeapons() {
  const container = $('weapons');
  if (!container) return;
  container.innerHTML = '';

  for (const weapon of WEAPONS) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className =
      'weapon' +
      (weapon.id === draft.weapon ? ' active' : '') +
      (weapon.implemented ? '' : ' locked');
    card.disabled = !weapon.implemented;

    const head = document.createElement('div');
    head.className = 'weapon-head';

    const name = document.createElement('b');
    name.textContent = weapon.name;

    const badge = document.createElement('span');
    badge.className = 'badge' + (weapon.implemented ? '' : ' muted');
    badge.textContent = weapon.implemented ? '已实现' : '未实现';

    head.append(name, badge);

    const meta = document.createElement('div');
    meta.className = 'weapon-group';
    meta.textContent = (WEAPON_GROUPS[weapon.group] || weapon.group) + ' · ' + weapon.input;

    const desc = document.createElement('p');
    desc.className = 'weapon-desc';
    desc.textContent = weapon.desc;

    card.append(head, meta, desc);

    card.addEventListener('click', () => {
      draft.weapon = weapon.id;
      renderWeapons();
      markDirty();
    });

    container.appendChild(card);
  }
}

function renderAdvanced() {
  const container = $('adv');
  const chips = $('adv-filter');
  if (!container || !chips) return;

  container.innerHTML = '';
  chips.innerHTML = '';

  const defs = [['all', '全部'], ...ADV_GROUPS];
  for (const [key, label] of defs) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip' + (advFilter === key ? ' active' : '');
    chip.textContent = label;
    chip.addEventListener('click', () => {
      advFilter = key;
      renderAdvanced();
    });
    chips.appendChild(chip);
  }

  const weapons = advFilter === 'all' ? ADV_GROUPS : ADV_GROUPS.filter(([key]) => key === advFilter);

  for (const [wKey, wLabel, subs] of weapons) {
    if (!ADV_FIELDS.some((field) => field.group === wKey)) continue;

    const title = document.createElement('h3');
    title.className = 'group-title';
    title.textContent = wLabel;
    container.appendChild(title);

    for (const [subKey, subLabel] of subs) {
      const fields = ADV_FIELDS.filter((field) => field.group === wKey && field.sub === subKey);
      if (!fields.length) continue;

      if (subKey === 'sfx') {
        // 音效标题旁挂「该武器用哪套来源」+「保存进当前方案」，这里不放试听/重置
        const head = document.createElement('div');
        head.className = 'subgroup-head';
        const h = document.createElement('h4');
        h.className = 'subgroup-title';
        h.textContent = subLabel;
        head.append(h, weaponSfxControls(wKey));
        container.appendChild(head);
      } else {
        const sub = document.createElement('h4');
        sub.className = 'subgroup-title';
        sub.textContent = subLabel;
        container.appendChild(sub);
      }

      const grid = document.createElement('div');
      grid.className = 'grid';
      for (const field of fields) grid.appendChild(field.sfx ? sfxRow(field) : fieldRow(field));
      container.appendChild(grid);
    }

    // 兜底：没归到二级分类的字段直接挂在武器下面
    const rest = ADV_FIELDS.filter(
      (field) => field.group === wKey && !subs.some(([subKey]) => field.sub === subKey)
    );
    if (rest.length) {
      const grid = document.createElement('div');
      grid.className = 'grid';
      for (const field of rest) grid.appendChild(field.sfx ? sfxRow(field) : fieldRow(field));
      container.appendChild(grid);
    }
  }
}

function renderAll() {
  const basic = $('basic');
  basic.innerHTML = '';
  for (const field of BASIC_FIELDS) {
    basic.appendChild(fieldRow(field));
    // 音效方案放在总音量之后：都是「常用」里的音频设置
    if (field.key === 'soundVolume') basic.appendChild(sfxProfileRow());
  }

  renderAdvanced();
  renderWeapons();
  markDirty();
}

// 重置 / 导入后整体重绘：筛选状态与分组都会重建，避免残留旧值
function syncControls() {
  renderAll();
}

function updatePreviewButton() {
  $('preview').textContent = previewing ? '退出试切（Esc）' : '开始试切';
}

// 试听要和实际游玩听到的一致，所以配置页同样挂上采样音效；
// 扩展用 runtime URL，桌面配置窗口用 IPC 读字节，都取不到就退回合成音
let cachedSoundAssets = null;
function soundAssets() {
  if (cachedSoundAssets) return cachedSoundAssets;
  cachedSoundAssets = {};
  try {
    if (isExt) {
      cachedSoundAssets = sampleUrls((p) => ext.runtime.getURL(p));
    } else if (window.desktop && window.desktop.assets) {
      cachedSoundAssets = sampleBytes((file) => window.desktop.assets.read(file));
    }
  } catch (e) {
    cachedSoundAssets = {};
  }
  return cachedSoundAssets;
}

function ensureCleaner() {
  if (!cleaner) {
    cleaner = createCleaner({
      config: { ...draft },
      soundAssets: soundAssets(),
      onStateChange(active) {
        previewing = active;
        updatePreviewButton();
      },
    });
  } else {
    cleaner.setConfig({ ...draft });
  }
  return cleaner;
}

function togglePreview() {
  const c = ensureCleaner();
  if (previewing) c.deactivate();
  else c.activate();
  updatePreviewButton();
}

function demoPoint() {
  const card = document.querySelector('#demo .demo-card');
  const rect = (card || $('demo')).getBoundingClientRect();
  return {
    x: Math.round(rect.left + rect.width / 2),
    y: Math.round(rect.top + rect.height / 2),
  };
}

async function init() {
  $('host').textContent = '当前：' + hostName();

  const loaded = await loadConfig();
  draft = cloneConfig({ ...DEFAULT_CONFIG, ...loaded });
  saved = cloneConfig(draft);

  renderAll();

  $('save').addEventListener('click', async () => {
    try {
      await saveConfig({ ...draft });
      saved = cloneConfig(draft);
      markDirty();
      toast('已保存');
    } catch (e) {
      toast('保存失败：' + (e && e.message ? e.message : e), true);
    }
  });

  $('reset').addEventListener('click', () => {
    draft = cloneConfig(DEFAULT_CONFIG);
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

  $('import').addEventListener('click', () => {
    $('import-text').value = '';
    $('import-dialog').showModal();
  });

  $('import-cancel').addEventListener('click', () => $('import-dialog').close());

  $('import-confirm').addEventListener('click', () => {
    if (applyImport($('import-text').value)) $('import-dialog').close();
  });

  $('preview').addEventListener('click', togglePreview);

  for (const button of document.querySelectorAll('[data-preview]')) {
    button.addEventListener('click', () => {
      const point = demoPoint();
      ensureCleaner().preview(point.x, point.y, button.dataset.preview);
    });
  }

  const demoHtml = $('demo').innerHTML;
  $('demo-reset').addEventListener('click', () => {
    $('demo').innerHTML = demoHtml;
  });

  // 自检入口：直接返回 preview 的执行结果
  window.__configPreview = (kind) => {
    const point = demoPoint();
    try {
      return JSON.stringify(ensureCleaner().preview(point.x, point.y, kind));
    } catch (e) {
      return JSON.stringify({ ok: false, error: String(e && e.message) });
    }
  };
}

// 只接受已知字段；类型不符的跳过，避免把界面写坏
function applyImport(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    toast('JSON 解析失败', true);
    return false;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    toast('需要一个 JSON 对象', true);
    return false;
  }

  let count = 0;
  for (const key of Object.keys(DEFAULT_CONFIG)) {
    if (!(key in parsed)) continue;
    const expected = typeof DEFAULT_CONFIG[key];
    const value = parsed[key];
    const ok =
      typeof value === expected && (expected !== 'number' || Number.isFinite(value));
    if (!ok) continue;

    // 武器只接受已实现的，避免导入后切到空实现
    if (key === 'weapon') {
      const target = WEAPONS.find((item) => item.id === value);
      if (!target || !target.implemented) continue;
    }

    draft[key] = value;
    count++;
  }

  syncControls();

  if (count === 0) {
    toast('没有识别到可用字段', true);
    return false;
  }

  toast(`已导入 ${count} 项，记得保存`);
  return true;
}

init();
