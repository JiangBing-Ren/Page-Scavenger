// 用 Web Audio 现场合成音效，不依赖音频文件。
// 浏览器要求用户手势后才能播放，所以 context 在第一次切割（pointerdown 之后）才创建。

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

  function volume() {
    const v = Number((config() || {}).soundVolume);
    return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.5;
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

  // 叠刀 / 命中：金属“锵”，音高随刀数上升
  function slice(step) {
    if (!enabled()) return;
    const ctx = ready();
    if (!ctx) return;

    const n = Math.max(1, Math.min(12, Number(step) || 1));
    const t = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(560 + n * 45, t);
    osc.frequency.exponentialRampToValueAtTime(1300 + n * 70, t + 0.055);

    const peak = 0.16 * volume();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);

    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.18);

    // 金属摩擦的瞬态，让“切”更像切
    if (!cachedNoise) cachedNoise = noiseBuffer(ctx);
    const src = ctx.createBufferSource();
    src.buffer = cachedNoise;

    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2600;

    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.12 * volume(), t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);

    src.connect(hp).connect(ng).connect(ctx.destination);
    src.start(t);
    src.stop(t + 0.08);
  }

  // 松手炸开：低频冲击 + 高频噪声
  function burst() {
    if (!enabled()) return;
    const ctx = ready();
    if (!ctx) return;

    const t = ctx.currentTime;
    const vol = volume();

    const osc = ctx.createOscillator();
    const og = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(38, t + 0.34);
    og.gain.setValueAtTime(0.45 * vol, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    osc.connect(og).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.42);

    if (!cachedNoise) cachedNoise = noiseBuffer(ctx);
    const src = ctx.createBufferSource();
    src.buffer = cachedNoise;

    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1100;

    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.3 * vol, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);

    src.connect(hp).connect(ng).connect(ctx.destination);
    src.start(t);
    src.stop(t + 0.3);
  }

  // 枪声：左轮低频闷响 + 锐利爆裂；机枪高频短促的「哒」
  function shot(kind) {
    if (!enabled()) return;
    const ctx = ready();
    if (!ctx) return;

    const heavy = kind === 'revolver';
    const t = ctx.currentTime;
    const vol = volume();

    if (!cachedNoise) cachedNoise = noiseBuffer(ctx);

    if (heavy) {
      const boom = ctx.createOscillator();
      const bg = ctx.createGain();
      boom.type = 'sine';
      boom.frequency.setValueAtTime(150, t);
      boom.frequency.exponentialRampToValueAtTime(42, t + 0.32);
      bg.gain.setValueAtTime(0.5 * vol, t);
      bg.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);
      boom.connect(bg).connect(ctx.destination);
      boom.start(t);
      boom.stop(t + 0.4);

      const src = ctx.createBufferSource();
      src.buffer = cachedNoise;

      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 1200;

      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.42 * vol, t);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);

      src.connect(hp).connect(ng).connect(ctx.destination);
      src.start(t);
      src.stop(t + 0.1);
      return;
    }

    const osc = ctx.createOscillator();
    const og = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(1500, t);
    osc.frequency.exponentialRampToValueAtTime(620, t + 0.045);
    og.gain.setValueAtTime(0.22 * vol, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    osc.connect(og).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.07);

    const src = ctx.createBufferSource();
    src.buffer = cachedNoise;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2600;
    bp.Q.value = 1.6;

    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.2 * vol, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);

    src.connect(bp).connect(ng).connect(ctx.destination);
    src.start(t);
    src.stop(t + 0.05);
  }

  // 换弹：两声金属咔哒 + 弹仓旋转的低沉尾声
  function reload() {
    if (!enabled()) return;
    const ctx = ready();
    if (!ctx) return;

    const vol = volume();
    if (!cachedNoise) cachedNoise = noiseBuffer(ctx);

    const clickAt = (delay, freq, gain) => {
      const t = ctx.currentTime + delay;
      const src = ctx.createBufferSource();
      src.buffer = cachedNoise;

      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = freq;
      bp.Q.value = 2.4;

      const g = ctx.createGain();
      g.gain.setValueAtTime(gain * vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);

      src.connect(bp).connect(g).connect(ctx.destination);
      src.start(t);
      src.stop(t + 0.08);
    };

    clickAt(0, 2400, 0.5);
    clickAt(0.13, 1500, 0.4);

    const t = ctx.currentTime + 0.02;
    const osc = ctx.createOscillator();
    const og = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(240, t);
    osc.frequency.exponentialRampToValueAtTime(80, t + 0.3);
    og.gain.setValueAtTime(0.18 * vol, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    osc.connect(og).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.34);
  }

  return { slice, burst, shot, reload, unlock: ready };
}
