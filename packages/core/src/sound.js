// 音效分两层：能取到采样文件就播采样，取不到或解码失败时回落到 Web Audio 合成。
// 每个效果是独立的声音（VOICES），各自受 sfx<Name> 音量倍率控制，
// 便于在配置器里逐项对比、单独静音。
import { pickSfxSource } from './sfxprofile.js';

// 采样清单。宿主只需按 file 提供 URL（扩展）或字节（桌面）；
// rate 是固定播放倍速，jitter 是每次播放的随机倍速浮动幅度（0 = 不浮动）；
// gain 是采样自身的响度校准，配置里的倍率 1 就对应「校准后的这一档」。
export const SAMPLE_ASSETS = {
  shellDrop: { file: 'shell-drop.mp3', gain: 0.6 },
  // 单发枪声：轻微音高浮动，避免连射时完全一致
  revolverFire: { file: 'revolver-fire.mp3', jitter: 0.16, gain: 0.7 },
  // 换弹原始 3.216 秒，2 倍速压到约 1.6 秒，与 revolverReloadMs 对齐
  reload: { file: 'revolver-reload.mp3', rate: 2, jitter: 0, gain: 2 },
  // 刀：1-2-3-4-5 五档挥砍。2/3/4 是从 1 与 5 按 7:3 / 5:5 / 3:7 混合生成的过渡，
  // 连斩时按刀序取用，超过五刀走中间三档的循环（见 engine 的 bladeSfxForCut）
  bladeSwing: { file: 'blade-swing.mp3', jitter: 0.1, gain: 0.85 },
  bladeSwing2: { file: 'blade-swing-2.wav', jitter: 0.05, gain: 0.9 },
  bladeSwing3: { file: 'blade-swing-3.wav', jitter: 0.05, gain: 0.9 },
  bladeSwing4: { file: 'blade-swing-4.wav', jitter: 0.05, gain: 0.9 },
  bladeFinish: { file: 'blade-finish.wav', jitter: 0.04, gain: 0.95 },
  // 激光炮：蓄力 7.03s（足够覆盖蓄力 + 过量段）、发射 1.62s、过量发射 1.31s
  laserCharge: { file: 'laser-charge.mp3', jitter: 0, gain: 0.85 },
  laserFire: { file: 'laser-fire.mp3', jitter: 0.06, gain: 0.9 },
  laserOverFire: { file: 'laser-overfire.mp3', jitter: 0.05, gain: 0.95 },
  // 烧蚀命中（laserHit）目前只有合成实现。sampleUrls 是按这份清单拼路径的，
  // 登记一个不存在的文件会让 UI 以为有采样、实际却要回落——所以宁可不登记。
};

export function sampleUrls(getUrl) {
  const out = {};
  Object.keys(SAMPLE_ASSETS).forEach((name) => {
    const meta = SAMPLE_ASSETS[name];
    const url = getUrl('assets/' + meta.file);
    if (url) out[name] = { url, rate: meta.rate, jitter: meta.jitter, gain: meta.gain };
  });
  return out;
}

// 桌面版：页面不能 fetch file://，改由 IPC 读字节
export function sampleBytes(read) {
  const out = {};
  Object.keys(SAMPLE_ASSETS).forEach((name) => {
    const meta = SAMPLE_ASSETS[name];
    let data = null;
    try {
      data = read(meta.file);
    } catch (e) {}
    if (data) out[name] = { data, rate: meta.rate, jitter: meta.jitter, gain: meta.gain };
  });
  return out;
}

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

  // 弹壳落地：优先用采样，合成兜底用非谐波分音模拟金属撞击
  shellDrop(ctx, vol) {
    const base = 900 + Math.random() * 320;
    const ratios = [1, 2.76, 5.4, 8.93];
    ratios.forEach((ratio, i) => {
      const partial = (0.22 / (i + 1)) * vol;
      tone(ctx, partial, 'sine', base * ratio, base * ratio * 0.9, 0.22 - i * 0.04, 0.002);
    });
    click(ctx, 0.28 * vol, 4200, 0.02, 4);
  },

  // 黑洞：生成，低频下坠 + 空气被抽走
  blackholeOpen(ctx, vol) {
    tone(ctx, 0.5 * vol, 'sine', 150, 34, 0.8, 0.02);
    swept(ctx, 0.22 * vol, 'lowpass', 1400, 180, 0.9, 0.7, 0.05);
  },

  // 黑洞：持续嗡鸣。实际播放走 startHum，这里只做 1.2 秒版本给配置器试听
  blackholeHum(ctx, vol) {
    tone(ctx, 0.12 * vol, 'sine', 58, 52, 1.2, 0.12);
    tone(ctx, 0.06 * vol, 'triangle', 87, 79, 1.2, 0.12);
    swept(ctx, 0.05 * vol, 'lowpass', 520, 260, 0.8, 1.2, 0.15);
  },

  // 黑洞：吞噬，短促下坠
  blackholeEat(ctx, vol) {
    tone(ctx, 0.16 * vol, 'sine', 620, 90, 0.16, 0.004);
    click(ctx, 0.1 * vol, 1200, 0.05, 1.8);
  },

  // 激光炮：满蓄力后的一次性发射，低频轰击 + 高频撕裂
  laserFire(ctx, vol) {
    tone(ctx, 0.42 * vol, 'sawtooth', 620, 90, 0.42, 0.005);
    tone(ctx, 0.26 * vol, 'sine', 120, 42, 0.4, 0.004);
    swept(ctx, 0.3 * vol, 'highpass', 1200, 4200, 1.0, 0.28, 0.006);
    click(ctx, 0.2 * vol, 3200, 0.05, 2.0);
  },

  // 激光炮：烧蚀命中，嘶嘶声 + 闷响
  laserHit(ctx, vol) {
    swept(ctx, 0.2 * vol, 'bandpass', 2600, 900, 0.8, 0.16, 0.01);
    click(ctx, 0.12 * vol, 1800, 0.04, 1.6);
    tone(ctx, 0.08 * vol, 'triangle', 420, 180, 0.12, 0.006);
  },

  // 激光炮：蓄力持续嗡鸣。实际播放走 startHum('laserBeam')，这里只做 1.2 秒试听版
  laserBeam(ctx, vol) {
    tone(ctx, 0.08 * vol, 'sine', 180, 420, 1.2, 0.08);
    tone(ctx, 0.05 * vol, 'triangle', 360, 840, 1.2, 0.08);
    swept(ctx, 0.04 * vol, 'bandpass', 1600, 4200, 1.4, 1.2, 0.1);
  },

  // 激光炮：蓄力采样缺失时的合成兜底（1.2 秒上扬，与 laserChargeMs 对齐）
  laserCharge(ctx, vol) {
    tone(ctx, 0.1 * vol, 'sine', 160, 480, 1.2, 0.06);
    tone(ctx, 0.06 * vol, 'triangle', 320, 960, 1.2, 0.06);
    swept(ctx, 0.05 * vol, 'bandpass', 1200, 4600, 1.3, 1.2, 0.08);
  },

  // 激光炮：过量蓄力发射的合成兜底（比普通发射更低沉更厚）
  laserOverFire(ctx, vol) {
    tone(ctx, 0.5 * vol, 'sawtooth', 520, 70, 0.5, 0.005);
    tone(ctx, 0.32 * vol, 'sine', 96, 34, 0.48, 0.004);
    swept(ctx, 0.36 * vol, 'highpass', 900, 3800, 1.1, 0.34, 0.006);
    click(ctx, 0.24 * vol, 2600, 0.06, 1.8);
  },
};

// 有 Web Audio 合成实现的槽位清单：直接从 VOICES 派生，避免手工维护第二份
export const SYNTH_SFX = Object.keys(VOICES);

export function createSound(getConfig, assets) {
  const config = typeof getConfig === 'function' ? getConfig : () => ({});

  // 采样音效：宿主可给 URL（扩展用 chrome-extension://）或原始字节（桌面用 IPC 读文件）。
  // 取不到或解码失败时回落到合成音。
  const assetUrls = assets || {};
  const sampleBuffers = {};
  const sampleFailed = {};
  const sampleMeta = {};

  // 三种写法都接受：URL 字符串、原始字节、或 { url | data, rate, jitter }
  function describe(asset) {
    if (typeof asset === 'string') return { url: asset };
    if (asset && (asset.url || asset.data)) return asset;
    return { data: asset };
  }

  function loadSample(name) {
    const asset = assetUrls[name];
    if (!asset || sampleBuffers[name] || sampleFailed[name]) return;

    const ctx = context();
    if (!ctx) return;

    const desc = describe(asset);
    sampleMeta[name] = desc;
    sampleFailed[name] = true; // 先标记，成功后清除，避免重复请求

    const decode = (buf) => {
      ctx
        .decodeAudioData(buf)
        .then((decoded) => {
          sampleBuffers[name] = decoded;
          sampleFailed[name] = false;
        })
        .catch(() => {});
    };

    if (desc.url) {
      fetch(desc.url)
        .then((res) => res.arrayBuffer())
        .then(decode)
        .catch(() => {});
      return;
    }

    // Uint8Array / ArrayBuffer：桌面版通过 IPC 读到文件字节
    try {
      const raw = desc.data;
      // Buffer 可能来自共享内存池，必须按 byteOffset/byteLength 截取
      const copy =
        raw instanceof ArrayBuffer
          ? raw.slice(0)
          : raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
      decode(copy);
    } catch (e) {}
  }

  let preloaded = false;
  // 采样解码是异步的，第一次播放等不到：在首次播放时把全部采样排进队列，
  // 这样第一发枪声不会退回合成音
  function preloadSamples() {
    if (preloaded) return;
    preloaded = true;
    Object.keys(assetUrls).forEach(loadSample);
  }

  function playSample(name, vol) {
    const buf = sampleBuffers[name];
    if (!buf) {
      loadSample(name);
      return false;
    }

    const ctx = ready();
    if (!ctx) return false;

    const meta = sampleMeta[name] || {};
    const base = Number(meta.rate) > 0 ? Number(meta.rate) : 1;
    const jitter = Number.isFinite(Number(meta.jitter))
      ? Math.max(0, Math.min(0.5, Number(meta.jitter)))
      : 0.2;
    // 采样响度校准：配置倍率 1 即校准后的基准，所以这里允许超过 1
    const trim = Number(meta.gain) > 0 ? Number(meta.gain) : 1;

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = base * (1 - jitter / 2 + Math.random() * jitter);

    const gain = ctx.createGain();
    gain.gain.value = Math.min(4, vol * trim);

    src.connect(gain).connect(ctx.destination);
    src.start();
    return true;
  }

  function enabled() {
    const c = config() || {};
    return c.soundEnabled !== false;
  }

  function master() {
    const v = Number((config() || {}).soundVolume);
    return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.6;
  }

  /**
   * 音量解析。双实现槽位（采样与合成都有）按当前来源读各自的键：
   *   sfx<Name>Sample / sfx<Name>Synth
   * 单实现槽位没有这两个后缀键，回落到 sfx<Name>。
   */
  function level(name, source) {
    const cfg = config() || {};
    const key = 'sfx' + name.charAt(0).toUpperCase() + name.slice(1);
    const legacy = Number(cfg[key]);
    const fallback = Number.isFinite(legacy) ? Math.max(0, Math.min(2, legacy)) : 1;
    const scoped = Number(cfg[key + (source === 'synth' ? 'Synth' : 'Sample')]);
    const mul = Number.isFinite(scoped) ? Math.max(0, Math.min(2, scoped)) : fallback;
    return master() * mul;
  }

  // 来源判断与配置器共用 pickSfxSource：档位 → 逐项 → 缺失回落，
  // 保证「只有采样的槽位」在「全部合成」档下仍能出声
  function resolveSource(name, cfg) {
    const c = cfg || config() || {};
    return pickSfxSource(c, name, !!assetUrls[name], SYNTH_SFX.indexOf(name) !== -1);
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


  // 持续嗡鸣：存活期间一直响，收起时淡出。不走 play()，因为需要循环音。
  // 黑洞低沉下坠、激光明亮稳定；按名称共用一套节点，避免两把武器同时占着振荡器。
  const HUM_PRESETS = {
    blackholeHum: {
      low: [62, 46, 'sine'],
      mid: [93, 69, 'triangle'],
      air: [700, 260, 'lowpass'],
      gain: 0.14,
      ramp: 2.4,
    },
    // 蓄力时频率持续上扬，听感能直接反映 charge 比例
    laserBeam: {
      low: [180, 420, 'sine'],
      mid: [360, 840, 'triangle'],
      air: [1600, 4200, 'bandpass'],
      gain: 0.08,
      ramp: 1.2,
    },
  };
  let hum = null;

  function startHum(name) {
    if (hum) return;
    const key = HUM_PRESETS[name] ? name : 'blackholeHum';
    const preset = HUM_PRESETS[key];
    // 持续音只能由振荡器产生，固定按合成那一套取音量
    const vol = level(key, 'synth');
    if (vol <= 0.002) return;
    const ctx = ready();
    if (!ctx) return;

    const t = ctx.currentTime;
    const bus = ctx.createGain();
    bus.gain.setValueAtTime(0.0001, t);
    bus.gain.exponentialRampToValueAtTime(Math.max(0.0002, preset.gain * vol), t + 0.25);
    bus.connect(ctx.destination);

    const low = ctx.createOscillator();
    low.type = preset.low[2];
    low.frequency.setValueAtTime(preset.low[0], t);
    low.frequency.linearRampToValueAtTime(preset.low[1], t + preset.ramp);

    const mid = ctx.createOscillator();
    mid.type = preset.mid[2];
    mid.frequency.setValueAtTime(preset.mid[0], t);
    mid.frequency.linearRampToValueAtTime(preset.mid[1], t + preset.ramp);

    const air = noise(ctx);
    air.loop = true;
    const airFilter = ctx.createBiquadFilter();
    airFilter.type = preset.air[2];
    airFilter.frequency.setValueAtTime(preset.air[0], t);
    airFilter.frequency.linearRampToValueAtTime(preset.air[1], t + preset.ramp);
    const airGain = ctx.createGain();
    airGain.gain.value = 0.12;

    low.connect(bus);
    mid.connect(bus);
    air.connect(airFilter).connect(airGain).connect(bus);

    low.start(t);
    mid.start(t);
    air.start(t);
    hum = { ctx, master: bus, nodes: [low, mid, air] };
  }

  function stopHum() {
    if (!hum) return;
    const { ctx, master, nodes } = hum;
    hum = null;
    const t = ctx.currentTime;
    try {
      master.gain.cancelScheduledValues(t);
      master.gain.setValueAtTime(Math.max(0.0001, master.gain.value), t);
      master.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      nodes.forEach((node) => {
        try {
          node.stop(t + 0.35);
        } catch (e) {}
      });
    } catch (e) {}
  }

  function play(name) {
    if (!enabled()) return false;
    const cfg = config() || {};

    // 来源由预设 + 单项偏好决定，不再有写死白名单
    const source = resolveSource(name, cfg);
    const gain = level(name, source);
    if (gain <= 0.002) return false;

    preloadSamples();

    // 选采样且资源就绪时优先采样；缺失或解码失败自动回落合成
    if (source === 'sample' && assetUrls[name] && playSample(name, gain)) return true;

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

  return { play, unlock: ready, startHum, stopHum, voices: Object.keys(VOICES) };
}
