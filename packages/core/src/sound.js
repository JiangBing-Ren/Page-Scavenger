// 用 Web Audio 现场合成音效，不依赖音频文件。
// 每个效果是独立的声音（VOICES），各自受 sfx<Name> 音量倍率控制，
// 便于在配置器里逐项对比、单独静音。

let shared = null;

function context() {
  if (shared) return shared;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  try {
    shared = new Ctor();
  } catch (e) {
    shared = null;
  }
  return shared;
}

function noiseBuffer(ctx) {
  const length = Math.floor(ctx.sampleRate * 0.4);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

let cachedNoise = null;

export function createSound(getConfig) {
  const config = typeof getConfig === 'function' ? getConfig : () => ({});

  function enabled() {
    const c = config() || {};
    return c.soundEnabled !== false;
  }

  function master() {
    const v = Number((config() || {}).soundVolume);
    return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.6;
  }

  function level(name) {
    const key = 'sfx' + name.charAt(0).toUpperCase() + name.slice(1);
    const raw = Number((config() || {})[key]);
    const mul = Number.isFinite(raw) ? Math.max(0, Math.min(2, raw)) : 1;
    return master() * mul;
  }

  function ready() {
    const ctx = context();
    if (!ctx) return null;
    if (ctx.state === 'suspended') {
      const p = ctx.resume();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    }
    return ctx;
  }

  const noise = (ctx) => {
    if (!cachedNoise) cachedNoise = noiseBuffer(ctx);
    const src = ctx.createBufferSource();
    src.buffer = cachedNoise;
    return src;
  };

  // 噪声 + 带通，扫频从 f0 到 f1
  function swept(ctx, vol, type, f0, f1, q, dur, attack) {
    const src = noise(ctx);

    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(f0, ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(f1, ctx.currentTime + dur);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), ctx.currentTime + (attack || 0.01));
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);

    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start();
    src.stop(ctx.currentTime + dur + 0.02);
  }

  // 振荡器 + 扫频
  function tone(ctx, vol, type, f0, f1, dur, attack) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(f1, ctx.currentTime + dur);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), ctx.currentTime + (attack || 0.006));
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + dur + 0.02);
  }

  // 短促点击（换弹、机械声）
  function click(ctx, vol, freq, dur, q) {
    const src = noise(ctx);

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    filter.Q.value = q || 2.4;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(Math.max(0.0002, vol), ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);

    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start(ctx.currentTime);
    src.stop(ctx.currentTime + dur + 0.01);
  }

  const VOICES = {
    // 刀：气流扫频，偏“呼”的质感
    bladeSwing(ctx, vol) {
      swept(ctx, 0.26 * vol, 'bandpass', 480, 2800, 1.0, 0.2, 0.025);
      tone(ctx, 0.05 * vol, 'sine', 700, 1500, 0.12, 0.02);
    },

    // 刀：切入金属，高频“锵”
    bladeCut(ctx, vol) {
      tone(ctx, 0.12 * vol, 'triangle', 1800, 3200, 0.1, 0.004);
      click(ctx, 0.16 * vol, 4200, 0.06, 3.2);
    },

    // 刀：碎裂，多个短噪声错落
    bladeBreak(ctx, vol) {
      click(ctx, 0.22 * vol, 2600, 0.07, 1.6);
      setTimeout(() => click(ctx, 0.17 * vol, 1800, 0.09, 1.4), 55);
      setTimeout(() => click(ctx, 0.12 * vol, 1200, 0.12, 1.2), 120);
      tone(ctx, 0.1 * vol, 'triangle', 900, 500, 0.16, 0.01);
    },

    // 炮：低频轰击
    cannonFire(ctx, vol) {
      tone(ctx, 0.62 * vol, 'sine', 95, 28, 0.5, 0.005);
      swept(ctx, 0.3 * vol, 'lowpass', 900, 320, 0.7, 0.42, 0.01);
    },

    // 炮：裂缝逐块蔓延，短促的断裂
    cannonCrack(ctx, vol) {
      click(ctx, 0.2 * vol, 1600, 0.05, 1.4);
      tone(ctx, 0.07 * vol, 'square', 320, 180, 0.06, 0.004);
    },

    // 炮：终局爆散，低频 + 碎屑
    cannonBreak(ctx, vol) {
      tone(ctx, 0.5 * vol, 'sine', 120, 34, 0.38, 0.004);
      swept(ctx, 0.34 * vol, 'highpass', 900, 2600, 0.8, 0.3, 0.006);
    },

    // 左轮：闷响 + 锐利爆裂
    revolverFire(ctx, vol) {
      tone(ctx, 0.5 * vol, 'sine', 150, 42, 0.34, 0.004);
      swept(ctx, 0.4 * vol, 'highpass', 1200, 1900, 0.9, 0.1, 0.004);
    },

    // 左轮：弹孔命中，闷闷的“噗”
    revolverHit(ctx, vol) {
      tone(ctx, 0.18 * vol, 'sine', 260, 120, 0.16, 0.008);
      swept(ctx, 0.14 * vol, 'lowpass', 900, 400, 0.8, 0.14, 0.01);
    },

    // 机枪：高频短促“哒”
    machinegunFire(ctx, vol) {
      tone(ctx, 0.2 * vol, 'square', 1500, 620, 0.06, 0.003);
      swept(ctx, 0.18 * vol, 'bandpass', 2600, 1800, 1.6, 0.05, 0.003);
    },

    // 机枪：弹着，极短的碎屑声
    machinegunHit(ctx, vol) {
      click(ctx, 0.14 * vol, 3200, 0.035, 2.2);
    },

    // 换弹：两声金属咔哒 + 弹仓旋转
    reload(ctx, vol) {
      click(ctx, 0.7 * vol, 2400, 0.09, 2.6);
      setTimeout(() => click(ctx, 0.58 * vol, 1500, 0.11, 2.2), 130);
      setTimeout(() => tone(ctx, 0.32 * vol, 'square', 240, 80, 0.34, 0.01), 20);
    },

    // 弹壳落地：清脆的金属弹跳声
    shellDrop(ctx, vol) {
      click(ctx, 0.6 * vol, 3000, 0.09, 3.2);
      tone(ctx, 0.14 * vol, 'triangle', 2400, 1500, 0.12, 0.003);
    },
  };

  function play(name) {
    if (!enabled()) return false;
    const gain = level(name);
    if (gain <= 0.002) return false;

    const ctx = ready();
    if (!ctx) return false;

    const voice = VOICES[name];
    if (!voice) return false;

    try {
      voice(ctx, gain);
    } catch (e) {
      return false;
    }
    return true;
  }

  return { play, unlock: ready, voices: Object.keys(VOICES) };
}
