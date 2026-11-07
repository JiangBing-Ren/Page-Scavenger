// 音效方案（多套玩家自己的配置）的纯数据操作。
// 只处理配置对象、不碰 DOM，配置器与回归测试共用同一套逻辑。
//
// 一套方案只存数值：各武器的来源档位、各音效的两套音量、逐项来源偏好。
// 音频文件在 assets 目录里，不进配置，所以方案体积与音频码率无关。

import { DEFAULT_CONFIG, SFX_WEAPON } from './config.js';

const SCOPED_SUFFIXES = ['Source', 'Sample', 'Synth'];

export function capOf(name) {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

// 归属某把武器的全部音效名
export function weaponSfxNames(weaponKey) {
  return Object.keys(SFX_WEAPON).filter((name) => SFX_WEAPON[name] === weaponKey);
}

/**
 * 决定某个音效这次走采样还是合成。UI 与运行时必须共用这一份判断，
 * 否则会出现「下拉显示合成、实际却静音」这类不一致。
 *
 *   1) 该武器的 SoundSource 档位；custom 时看逐项的 sfx<Name>Source
 *   2) 想走的那一套如果不存在，就回落到另一套
 *      —— 只有采样的槽位（如刀第 2/3/4 刀）在「全部合成」档下仍走采样，
 *         不会因为没有合成实现而静音
 */
export function pickSfxSource(config, name, hasSample, hasSynth) {
  const cap = capOf(name);
  const weapon = SFX_WEAPON[name];
  const mode = (weapon && config[weapon + 'SoundSource']) || 'sample';
  const wantsSynth =
    mode === 'synth' || (mode === 'custom' && config['sfx' + cap + 'Source'] === 'synth');
  if (wantsSynth) return hasSynth ? 'synth' : hasSample ? 'sample' : 'synth';
  return hasSample ? 'sample' : 'synth';
}

// 方案收纳哪些键：sfx<Name>... 与 <weapon>SoundSource，排除方案容器与总音量本身
export function isSfxSettingKey(key) {
  if (key === 'sfxProfiles' || key === 'sfxProfileActive' || key === 'soundVolume') return false;
  if (key.indexOf('sfx') === 0) return true;
  return key.slice(-11) === 'SoundSource';
}

// 从配置里抽取整套音效设置
export function captureSfxValues(config) {
  const out = {};
  for (const key of Object.keys(config)) {
    if (isSfxSettingKey(key)) out[key] = config[key];
  }
  return out;
}

// 只抽取某把武器的音效设置（供「保存」按钮做局部保存）
export function captureWeaponValues(config, weaponKey) {
  const out = {};
  const sourceKey = weaponKey + 'SoundSource';
  if (sourceKey in DEFAULT_CONFIG) out[sourceKey] = config[sourceKey];
  for (const name of weaponSfxNames(weaponKey)) {
    const cap = capOf(name);
    for (const suffix of SCOPED_SUFFIXES) {
      const key = 'sfx' + cap + suffix;
      if (key in DEFAULT_CONFIG) out[key] = config[key];
    }
    const legacy = 'sfx' + cap;
    if (legacy in DEFAULT_CONFIG) out[legacy] = config[legacy];
  }
  return out;
}

/**
 * 把某把武器的音效键恢复成「方案里保存的值」。
 * 切换档位时调用：未保存的改动会被方案值覆盖，于是切走再切回来仍是上次保存的状态。
 */
export function restoreWeaponSfx(config, weaponKey, savedValues) {
  const saved = savedValues || {};
  const apply = (key) => {
    if (!(key in DEFAULT_CONFIG)) return;
    config[key] = saved[key] !== undefined ? saved[key] : DEFAULT_CONFIG[key];
  };
  apply(weaponKey + 'SoundSource');
  for (const name of weaponSfxNames(weaponKey)) {
    const cap = capOf(name);
    for (const suffix of SCOPED_SUFFIXES) apply('sfx' + cap + suffix);
    apply('sfx' + cap);
  }
}

// 应用整套方案：先把音效键复位到默认，再叠加方案保存的值
export function applyProfileTo(config, profile) {
  for (const key of Object.keys(DEFAULT_CONFIG)) {
    if (isSfxSettingKey(key)) config[key] = DEFAULT_CONFIG[key];
  }
  Object.assign(config, (profile && profile.values) || {});
  if (profile) config.sfxProfileActive = profile.name;
}
