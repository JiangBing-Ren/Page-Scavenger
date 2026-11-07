import {
  DEFAULT_CONFIG,
  SIZE_LEVELS,
  BLACKHOLE_STYLES,
  CANNON_BREAK_STYLES,
  BLADE_STYLES,
  LASER_STYLES,
  LASER_SOUND_STYLES,
} from './config.js';
import { cssPath } from './selector.js';
import { findSlashTarget } from './targeting.js';
import {
  spawnSparks,
  spawnDOMFragments,
  spawnMultiCutFragments,
  spawnBlastHole,
  spawnBlastCracks,
  spawnBlastBreakup,
  spawnSmoke,
  spawnShell,
  reslicePiece,
  spawnDevourFragments,
  spawnTornDevour,
} from './fragments.js';
import { buildBurnBand, applyBurn, restoreBurn, activeBurnEdges, clearBurns } from './burns.js';
import { spawnShatterWipe } from './shatter.js';
import { spawnSlashWipeFragments } from './slashwipe.js';
import { piecesAt, getPiece } from './pieces.js';
import { createSound } from './sound.js';
import { WEAPONS, getWeapon, blastSamplePoints } from './weapons.js';
import {
  drawEffects,
  drawTargetBoxes,
  drawTrail,
  updateParticles,
  drawCloseButton,
  drawTracers,
  drawFiringGuide,
  drawChambers,
  drawMuzzleFlash,
  drawBlackholes,
  drawShatterWipes,
  drawSlashWipes,
} from './render.js';
import { drawLaserEmitter, drawLaserColumn, drawBurnEdges } from './laserfx.js';

const now = () => performance.now();
const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

// 过量蓄力：满蓄力后继续按住，光柱宽度从 1 倍线性涨到 3 倍（上限由需求指定）
export const OVERCHARGE_WIDTH_CAP = 3;

// base 是 0~1 的蓄力进度，over 是 0~1 的过量进度。
// base=1、over=0 时为满蓄力宽度（1 倍），over 到 1 时为上限倍数。
// 刀的多刀音效：第 1 刀固定单次挥砍，最后一刀固定最后一击，
// 中间的刀用 2/3/4 三档小循环轮换。三种排列按 2-3-4 → 3-4-2 → 4-2-3 循环，
// 于是序列是 1,2,3,4,3,4,2,4,2,3,2,3,4,...（第 1 刀之后就接 2-3-4 的第一轮）。
const BLADE_SFX = ['bladeSwing', 'bladeSwing2', 'bladeSwing3', 'bladeSwing4', 'bladeFinish'];
const BLADE_LOOP = [
  [2, 3, 4],
  [3, 4, 2],
  [4, 2, 3],
];

/**
 * index 从 1 开始。传了 total 才能判定「最后一刀」——
 * 长按叠刀知道总刀数，普通拖动边划边切、无法预知总数，最后一档会顺延进循环。
 */
export function bladeSfxForCut(index, total) {
  const i = Math.max(1, Math.floor(Number(index) || 1));
  const n = Math.floor(Number(total) || 0);
  if (i <= 1) return BLADE_SFX[0];
  if (n > 1 && i >= n) return BLADE_SFX[BLADE_SFX.length - 1];
  const k = i - 2; // 中间段从第 2 刀开始数
  const level = BLADE_LOOP[Math.floor(k / 3) % BLADE_LOOP.length][k % 3];
  return BLADE_SFX[level - 1];
}

export function chargeWidthMul(base, over) {
  const b = clamp(base, 0, 1);
  const o = clamp(over, 0, 1);
  return (0.35 + 0.65 * b) * (1 + (OVERCHARGE_WIDTH_CAP - 1) * o);
}

/**
 * 宿主无关的斩击引擎。宿主（扩展 / 油猴 / Electron）只负责：
 * 提供存储 adapter、决定何时 activate、把配置塞进来。
 */
export function createCleaner(options) {
  const opts = options || {};
  const storage = opts.storage || null;
  const onStateChange = typeof opts.onStateChange === 'function' ? opts.onStateChange : () => {};
  const onSlash = typeof opts.onSlash === 'function' ? opts.onSlash : () => {};

  const CONFIG = Object.assign({}, DEFAULT_CONFIG, opts.config || {});
  const sound = createSound(() => CONFIG, opts.soundAssets || {});

  const state = {
    active: false,
    isDrawing: false,
    activeHits: new Map(),
    pieceHits: new Map(),
    lockedTargets: new Map(),
    flashes: [],
    particles: [],
    shockwaves: [],
    flashWhite: 0,
    shake: 0,
    cutSequence: null,
    batchRemaining: 0,
    canvas: null,
    ctx: null,
    dpr: 1,
    cssW: 0,
    cssH: 0,
    trail: [],
    prevPoint: null,
    rafId: null,
    observer: null,
    slashed: new WeakSet(),
    pending: new Set(),
    undoStack: [],
    closeBtn: null,
    listeners: [],
    marks: [],
    slashCount: 0,
    bladeCutIndex: 1, // 本次拖动的连斩刀序，决定播哪一档挥砍音
    lastFireAt: 0,
    firing: { active: false, muzzle: null, aim: null, lastShotAt: 0 },
    chambers: 6,
    reloadingUntil: 0,
    muzzleFlash: null,
    tracers: [],
    blackholes: [],
    shatterWipes: [],
    slashWipes: [],
    charging: null, // { startAt, x, y }：激光炮蓄力状态
    weaponSprite: {
      x: 0, y: 0, aimX: 0, aimY: 0,
      charge: 0, over: 0, recoil: 0,
      active: false, placed: false,
    },
    laserColumn: null, // 一次性贯穿光柱，绘制完即清
    laserBurns: [], // 待挖的烧痕队列，按光柱推进顺序逐个生效
    laserCooldownUntil: 0,
    blackholeCooldownUntil: 0,
    lastEatSfxAt: 0,
  };

  let saveTimer = null;

  // 叠刀抬升：目标被斩超过 3 刀后抬起并放大
  const lifted = new Map();

  function applyLift(el, scale, dy) {
    if (lifted.has(el)) {
      el.style.transform = `translateY(${dy}px) scale(${scale})`;
      return;
    }

    let computed = 'none';
    try {
      computed = window.getComputedStyle(el).transform;
    } catch (e) {}

    // 站点自己用了 transform 就不碰，避免破坏布局
    if (computed !== 'none') return;

    lifted.set(el, {
      transform: el.style.transform || '',
      transition: el.style.transition || '',
      origin: el.style.transformOrigin || '',
    });
    el.style.transformOrigin = 'center center';
    el.style.transition = 'transform 0.18s ease-out';
    el.style.transform = `translateY(${dy}px) scale(${scale})`;
  }

  function releaseLift(el) {
    if (!lifted.has(el)) return;
    const prev = lifted.get(el);
    lifted.delete(el);
    try {
      el.style.transition = prev.transition;
      el.style.transformOrigin = prev.origin;
      el.style.transform = prev.transform;
    } catch (e) {}
  }

  function releaseAllLifts() {
    for (const el of Array.from(lifted.keys())) releaseLift(el);
  }

  function currentWeapon() {
    const weapon = getWeapon(CONFIG.weapon);
    // 存储里若残留未实现的武器（例如手改存储），回退到刀，避免切击直接失灵
    if (weapon && weapon.implemented) return weapon;
    return getWeapon('blade');
  }

  // 目前只有「输入方式为拖动」的武器能走斩击路径，其余武器实现前不响应输入
  function canSlash() {
    const weapon = currentWeapon();
    return !!(weapon && weapon.implemented && weapon.input === 'drag');
  }

  function setWeapon(id) {
    const weapon = getWeapon(id);
    if (!weapon) return { ok: false, reason: 'unknown' };
    if (!weapon.implemented) return { ok: false, reason: 'not-implemented' };
    // 离开黑洞时把还在吸的奇点一起收掉，避免切武器后残留
    if (CONFIG.weapon === 'blackhole' && weapon.id !== 'blackhole') clearBlackholes();
    // 离开激光炮时取消蓄力与光柱；烧痕属于页面损伤，保留不随切武器撤销
    if (CONFIG.weapon === 'laser' && weapon.id !== 'laser') {
      state.charging = null;
      state.laserColumn = null;
      state.laserBurns = [];
      state.weaponSprite.active = false;
      state.firing.active = false;
      sound.stopHum();
    }
    CONFIG.weapon = weapon.id;
    // 首次切到激光炮时给炮台一个默认就位点；之后只在 pointerdown 时重新就位
    if (weapon.id === 'laser' && !state.weaponSprite.placed) {
      const s = state.weaponSprite;
      s.x = Math.round(window.innerWidth * 0.5);
      s.y = Math.round(window.innerHeight * 0.78);
      s.aimX = s.x;
      s.aimY = Math.max(0, s.y - 160);
      s.placed = true;
    }
    // 切到左轮时补满弹仓
    if (weapon.id === 'revolver') {
      state.chambers = Math.max(1, Math.floor(CONFIG.revolverChambers) || 6);
      state.reloadingUntil = 0;
    }
    return { ok: true, weapon: weapon.id };
  }

  // 炮：以点击点为圆心收集范围内目标，逐个摧毁。
  // 其他 click 类武器（手枪等）实现时在这里加自己的分支。
  function blastAt(cx, cy) {
    const t = now();
    if (t - state.lastFireAt < CONFIG.weaponCooldown) return;
    state.lastFireAt = t;

    const radius = CONFIG.cannonRadius;
    const env = { config: CONFIG, marks: state.marks, canvas: state.canvas };
    const found = [];
    const seen = new Set();

    for (const point of blastSamplePoints(cx, cy, radius)) {
      let stack;
      try {
        stack = document.elementsFromPoint(point.x, point.y);
      } catch (e) {
        continue;
      }
      if (!stack) continue;

      for (const node of stack) {
        if (!node || node.nodeType !== 1) continue;
        if (node === state.canvas || node === document.documentElement || node === document.body) {
          continue;
        }
        if (node.hasAttribute && node.hasAttribute('data-adslash-ui')) continue;

        const target = findSlashTarget(node, env);
        if (target && !seen.has(target)) {
          seen.add(target);
          found.push(target);
        }
        break;
      }
    }

    // 容器和它内部的元素同时命中时只保留容器，避免重复计分
    const targets = found.filter(
      (target) => !found.some((other) => other !== target && other.contains(target))
    );

    sound.play('cannonFire');
    // 炮击的冲击更重：震屏加强，双层冲击波
    state.shake = 1.25;
    state.shockwaves.push({ x: cx, y: cy, r: radius * 0.25, alpha: 1 });
    state.shockwaves.push({ x: cx, y: cy, r: radius * 0.55, alpha: 0.65 });

    // 玻璃碎裂每块都是完整 DOM 克隆：多目标同时命中时只让前两个走该形态，
    // 其余回退经典放射裂纹，避免一炮生成几十个克隆节点
    targets.forEach((target, index) => {
      holeDestroy(target, cx, cy, CONFIG.cannonRadius * CONFIG.blastHoleScale, {
        breakup: true,
        shatter: index < 2,
      });
    });

    if (!targets.length) {
      spawnSparks(
        state.particles,
        { left: cx - 8, top: cy - 8, width: 16, height: 16 },
        { x: cx, y: cy },
        { x: 1, y: 0 }
      );
    }
  }

  // ---------- 黑洞 ----------

  const holeAreaOf = (radius) => Math.PI * radius * radius;

  // 被吞时的滤镜：比原色略亮、略去饱和，但不像炮那样洗白
  const DEVOUR_FILTER = 'brightness(1.6) contrast(1.2) saturate(0.8)';

  function blackholeBaseRadius() {
    return Math.max(40, Number(CONFIG.blackholeRadius) || 150);
  }

  // 上限是视口面积的比例，换算回半径
  function blackholeMaxRadius() {
    const ratio = Number(CONFIG.blackholeMaxAreaRatio);
    const area =
      Math.max(1, window.innerWidth * window.innerHeight) *
      (Number.isFinite(ratio) ? Math.max(0, ratio) : 0.67);
    return Math.sqrt(area / Math.PI);
  }

  // 引力场：视界外再延伸 R × fieldRatio（半径 1 → 场半径 1.5）
  function fieldRadiusOf(hole) {
    const ratio = Number(CONFIG.blackholeFieldRatio);
    return hole.radius * (1 + (Number.isFinite(ratio) ? Math.max(0, ratio) : 0.5));
  }

  function placeBlackhole(cx, cy) {
    const t = now();
    const existing = state.blackholes[0];
    // 前一个洞还没缩完就继承它此刻的大小；完全消失后再点才是从头喂
    const inherited = existing ? Math.max(2, existing.radius) : 0;

    if (!inherited && t < state.blackholeCooldownUntil) return;
    state.blackholeCooldownUntil = t + Math.max(120, Number(CONFIG.blackholeCooldown) || 700);

    const holding = !!CONFIG.executeOnRelease;
    state.blackholes = [
      {
        x: cx,
        y: cy,
        radius: Math.min(blackholeMaxRadius(), inherited || blackholeBaseRadius()),
        baseRadius: blackholeBaseRadius(),
        bornAt: t,
        holding,
        shrinkFrom: 0,
        shrinkStart: 0,
        shrinkUntil: 0,
        devoured: new Set(),
      },
    ];

    sound.play('blackholeOpen');
    sound.startHum();
    state.shake = Math.max(state.shake, 0.2);

    // 非长按模式：点一下就开始收束，不再跟随光标
    if (!holding) releaseBlackhole();
  }

  function followBlackhole(x, y) {
    const hole = state.blackholes[0];
    if (!hole || !hole.holding) return;
    hole.x = x;
    hole.y = y;
  }

  // 松手：停止跟随，按「基础时长 + 每大 3 倍加 1 秒」在原地缩到消失
  function releaseBlackhole() {
    const hole = state.blackholes[0];
    if (!hole || hole.shrinkUntil) return;

    hole.holding = false;
    const growth = Math.max(1, hole.radius / Math.max(1, hole.baseRadius));
    const extra = Math.floor(Math.log(growth) / Math.log(3)) * 1000;
    const base = Number(CONFIG.blackholeDurationMs);
    const life = Math.max(600, (Number.isFinite(base) ? base : 2400) + extra);

    hole.shrinkFrom = hole.radius;
    hole.shrinkStart = now();
    hole.shrinkUntil = now() + life;
  }

  // 吸入一个元素：面积比决定整吞还是撕裂，真实元素立刻隐藏
  function eatTarget(hole, el) {
    if (state.slashed.has(el)) {
      hole.devoured.add(el);
      return;
    }

    const rect = el.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    if (w < 4 || h < 4) {
      hole.devoured.add(el);
      return;
    }

    const targetArea = w * h;
    const holeArea = holeAreaOf(hole.radius);
    const ratio = targetArea / Math.max(1, holeArea);

    const captureRatio = Number(CONFIG.blackholeCaptureRatio);
    const tearRatio = Number(CONFIG.blackholeTearRatio);
    const capture = Number.isFinite(captureRatio) ? captureRatio : 1.35;
    const tear = Number.isFinite(tearRatio) ? tearRatio : 0.7;

    // 吸不动的目标不记账，等洞长大后再判定
    if (ratio > capture) return;

    // 面积够小但某一维超过直径时，也要按最长边撕开（长条广告）
    const diameter = hole.radius * 2;
    const tooLong = Math.max(w, h) > diameter;
    const needTear = ratio > tear || tooLong;

    let pieces = 1;
    if (needTear) {
      const byArea = Math.ceil(targetArea / Math.max(1, tear * holeArea));
      const byLength = tooLong ? Math.ceil(Math.max(w, h) / Math.max(1, diameter)) : 1;
      pieces = Math.min(12, Math.max(1, byArea, byLength));
    }

    const sel = cssPath(el);
    const prevStyle = el.getAttribute('style');
    hole.devoured.add(el);

    try {
      hideEl(el);
      state.slashed.add(el);
      releaseLift(el);
      if (sel) addMark(sel);
      state.undoStack.push({ sel, prevStyle });
      if (state.undoStack.length > 20) state.undoStack.shift();

      // 需要撕裂就走裂隙粉碎（以最近点为撕裂源扇形切裂）；整吞才是一整块飞进去
      if (needTear) {
        spawnTornDevour(el, rect, hole.x, hole.y, { filter: DEVOUR_FILTER, pieces, hole });
      } else {
        spawnDevourFragments(el, rect, hole.x, hole.y, { filter: DEVOUR_FILTER, pieces: 1 });
      }

      // 成长：吸入面积按效率折算进黑洞面积，上限是视口面积的比例
      const eff = Number(CONFIG.blackholeGrowEfficiency);
      const gain = Number.isFinite(eff) ? Math.max(0, Math.min(1, eff)) : 0.01;
      const grown = Math.min(holeAreaOf(blackholeMaxRadius()), holeArea + targetArea * gain);
      hole.radius = Math.max(1, Math.sqrt(grown / Math.PI));
      // 2D 版吞噬脉冲环的时间戳；3D 版不读这个字段，无副作用
      hole.pulseAt = now();

      // 一次吸进多个元素时别把吞噬音叠成一坨
      const t = now();
      if (t - state.lastEatSfxAt > 70) {
        state.lastEatSfxAt = t;
        sound.play('blackholeEat');
      }

      state.slashCount++;
      onSlash({ el, rect, count: state.slashCount, blast: true, weapon: 'blackhole' });
    } catch (e) {
      hideEl(el);
    }
  }

  // 每帧结算：先按收束进度缩半径，再扫描引力场里的元素
  function stepBlackholes() {
    const hole = state.blackholes[0];
    if (!hole) return;

    const t = now();

    if (hole.shrinkUntil) {
      const span = Math.max(1, hole.shrinkUntil - hole.shrinkStart);
      const progress = Math.min(1, (t - hole.shrinkStart) / span);
      hole.radius = hole.shrinkFrom * (1 - progress);
      if (progress >= 1 || hole.radius < 2) {
        state.blackholes = [];
        sound.stopHum();
        return;
      }
    }

    const reach = fieldRadiusOf(hole);
    const env = { config: CONFIG, marks: state.marks, canvas: state.canvas };

    // 圆心 + 三圈采样点：只扫圆心会漏掉场边缘的元素
    const points = [{ x: hole.x, y: hole.y }];
    for (const ring of [0.35, 0.65, 0.92]) {
      for (let k = 0; k < 14; k++) {
        const angle = (k / 14) * Math.PI * 2 + ring;
        points.push({
          x: hole.x + Math.cos(angle) * reach * ring,
          y: hole.y + Math.sin(angle) * reach * ring,
        });
      }
    }

    for (const point of points) {
      let stack;
      try {
        stack = document.elementsFromPoint(point.x, point.y);
      } catch (e) {
        continue;
      }
      if (!stack) continue;

      for (const node of stack) {
        if (!node || node.nodeType !== 1) continue;
        if (node === state.canvas || node === document.documentElement || node === document.body) {
          continue;
        }
        if (node.hasAttribute && node.hasAttribute('data-adslash-ui')) continue;

        const target = findSlashTarget(node, env);
        if (target && !hole.devoured.has(target)) eatTarget(hole, target);
        break;
      }
    }
  }

  function clearBlackholes() {
    state.blackholes = [];
    state.blackholeCooldownUntil = 0;
    sound.stopHum();
  }

  // hold 类武器的逐帧参数表：避免把武器名写死在 fireStep 里
  const HOLD_PARAMS = {
    machinegun: {
      cooldown: (c) => c.machinegunCooldown,
      holeRadius: (c) => c.machinegunHoleRadius,
      spread: (c) => c.machinegunSpread,
      fire: 'machinegunFire',
    },
    revolver: {
      cooldown: (c) => c.revolverCooldown,
      holeRadius: (c) => c.revolverHoleRadius,
      spread: () => 0,
      fire: 'revolverFire',
    },
  };

  // 沿线段采样，返回第一个可切目标与命中点。机枪与激光共用
  function raycastTarget(from, to) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const steps = Math.max(2, Math.ceil(Math.hypot(dx, dy) / CONFIG.sampleStep));
    const env = { config: CONFIG, marks: state.marks, canvas: state.canvas };

    for (let i = 1; i <= steps; i++) {
      const u = i / steps;
      const x = from.x + dx * u;
      const y = from.y + dy * u;

      let stack;
      try {
        stack = document.elementsFromPoint(x, y);
      } catch (e) {
        continue;
      }
      if (!stack) continue;

      for (const node of stack) {
        if (!node || node.nodeType !== 1) continue;
        if (node === state.canvas || node === document.documentElement || node === document.body) {
          continue;
        }
        if (node.hasAttribute && node.hasAttribute('data-adslash-ui')) continue;

        const target = findSlashTarget(node, env);
        if (target && !state.slashed.has(target) && !state.pending.has(target)) {
          return { target, point: { x, y } };
        }
        break;
      }
    }
    return null;
  }

  // 把全局线段裁到元素矩形，得到烧蚀带的中心线（Liang-Barsky）
  function clipSegmentToBox(from, to, rect) {
    let t0 = 0;
    let t1 = 1;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const tests = [
      [-dx, from.x - rect.left],
      [dx, rect.right - from.x],
      [-dy, from.y - rect.top],
      [dy, rect.bottom - from.y],
    ];
    for (const [p, q] of tests) {
      if (Math.abs(p) < 1e-9) {
        if (q < 0) return null;
        continue;
      }
      const r = q / p;
      if (p < 0) {
        if (r > t1) return null;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return null;
        if (r < t1) t1 = r;
      }
    }
    if (t1 - t0 < 0.001) return null;
    return {
      x1: from.x + dx * t0,
      y1: from.y + dy * t0,
      x2: from.x + dx * t1,
      y2: from.y + dy * t1,
    };
  }

  // 烧蚀达阈值：恢复原 mask 后按「目标整体消失」结算，沿用现有撤销/标记/计分链路
  function finishBurnTarget(el, rect, cx, cy) {
    restoreBurn(el);
    const sel = cssPath(el);
    const prevStyle = el.getAttribute('style');
    hideEl(el);
    state.slashed.add(el);
    releaseLift(el);
    if (sel) addMark(sel);
    state.undoStack.push({ sel, prevStyle });
    if (state.undoStack.length > 20) state.undoStack.shift();
    spawnSparks(state.particles, rect, { x: cx, y: cy }, { x: 1, y: 0 });
    state.slashCount++;
    onSlash({ el, rect, count: state.slashCount, weapon: CONFIG.weapon });
  }

  // 只计算「这条光柱会在这个元素上留下什么」，不立刻挖洞。
  // 真正的 apply 由队列按光柱推进顺序触发，痕迹才会跟着激光出现，
  // 而不是发射瞬间整条一起冒出来。
  function planBurn(el, from, to, half, threshold, beam) {
    const rect = el.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) return null;
    const clipped = clipSegmentToBox(from, to, rect);
    if (!clipped) return null;

    const a = { x: clipped.x1 - rect.left, y: clipped.y1 - rect.top };
    const b = { x: clipped.x2 - rect.left, y: clipped.y2 - rect.top };
    if (Math.hypot(b.x - a.x, b.y - a.y) < 6) return null;

    const intensity = clamp(Number(CONFIG.laserBurnIntensity) || 1, 0.3, 2);
    const band = buildBurnBand(
      a,
      b,
      half,
      Math.random() * 100,
      { w: rect.width, h: rect.height },
      intensity
    );
    if (!band) return null; // 只擦到边角、不足以形成烧痕时跳过

    const cx = (clipped.x1 + clipped.x2) / 2;
    const cy = (clipped.y1 + clipped.y2) / 2;
    // 目标中心在光柱上的投影位置 → 决定它排在第几个出现
    const proj = ((cx - beam.from.x) * beam.dx + (cy - beam.from.y) * beam.dy) / Math.max(1, beam.range);
    return { el, rect, band, cx, cy, threshold, u: clamp(proj, 0, 1) };
  }

  function applyBurnJob(job) {
    const result = applyBurn(job.el, job.band, { threshold: job.threshold });
    if (result.complete) {
      finishBurnTarget(job.el, job.rect, job.cx, job.cy);
      return;
    }
    sound.play('laserHit');
    state.slashCount++;
    onSlash({
      el: job.el,
      rect: job.rect,
      count: state.slashCount,
      weapon: CONFIG.weapon,
      area: result.added,
      burned: result.ratio,
    });
  }

  // 激光炮：蓄力结束后一次性发射贯穿光柱，沿途所有目标都被烧一条带
  function fireLaser(from, aim, ratio) {
    const t = now();
    if (t < state.laserCooldownUntil) return;

    const chargeMs = Math.max(100, Number(CONFIG.laserChargeMs) || 1200);
    const overMs = Math.max(100, Number(CONFIG.laserOverchargeMs) || 1200);
    const base = clamp(ratio, 0, 1);
    const over = clamp(((ratio - 1) * chargeMs) / overMs, 0, 1);
    const scale = 0.35 + 0.65 * base;
    // 只有宽度吃过量加成；射程与贯穿数在满蓄力就封顶
    const width = Math.max(4, Number(CONFIG.laserWidth) || 18) * chargeWidthMul(base, over);
    // 蓄力决定「穿过瞄准点之后还能深入多远」，而不是绝对射程：
    // 这样无论短按还是满蓄力，光柱都会越过光标，不会出现够不到鼠标的情况
    const depth = Math.max(160, (Number(CONFIG.laserRange) || 1400) * scale);
    const maxTargets = Math.max(1, Math.round((Number(CONFIG.laserMaxTargets) || 8) * scale));
    const threshold = clamp(Number(CONFIG.laserBurnThreshold) || 0.6, 0.05, 1);
    const durationMs = Math.max(200, Number(CONFIG.laserColumnMs) || 900);
    // 冷却允许配成 0，不能用 `|| 默认值`（0 是 falsy 会被默认值吃掉）
    const cooldownRaw = Number(CONFIG.laserCooldownMs);
    const cooldown = Number.isFinite(cooldownRaw) ? Math.max(0, cooldownRaw) : 420;

    let dx = aim.x - from.x;
    let dy = aim.y - from.y;
    let aimDist = Math.hypot(dx, dy);
    if (aimDist < 8) {
      dx = 1;
      dy = 0;
      aimDist = 0;
    } else {
      dx /= aimDist;
      dy /= aimDist;
    }
    const range = aimDist + depth;
    const to = { x: from.x + dx * range, y: from.y + dy * range };

    state.laserColumn = {
      from,
      to,
      width,
      t0: t,
      durationMs,
      style: CONFIG.laserStyle,
      charge: base,
      over,
    };
    state.laserCooldownUntil = t + cooldown;
    // 进入过量段后换用更厚重的发射音
    sound.play(over > 0.01 ? 'laserOverFire' : 'laserFire');
    state.shake = Math.max(state.shake, 0.3 + 0.3 * ratio);

    // 沿光柱采样收集所有目标（不是最近一个）
    const steps = Math.max(4, Math.ceil(range / CONFIG.sampleStep));
    const env = { config: CONFIG, marks: state.marks, canvas: state.canvas };
    const seen = new Set();
    const targets = [];
    for (let i = 1; i <= steps; i++) {
      const u = i / steps;
      const x = from.x + (to.x - from.x) * u;
      const y = from.y + (to.y - from.y) * u;
      let stack;
      try {
        stack = document.elementsFromPoint(x, y);
      } catch (e) {
        continue;
      }
      if (!stack) continue;
      for (const node of stack) {
        if (!node || node.nodeType !== 1) continue;
        if (node === state.canvas || node === document.documentElement || node === document.body) continue;
        if (node.hasAttribute && node.hasAttribute('data-adslash-ui')) continue;
        const target = findSlashTarget(node, env);
        if (target && !seen.has(target) && !state.slashed.has(target) && !state.pending.has(target)) {
          seen.add(target);
          targets.push(target);
        }
        break;
      }
    }

    // 容器与内部元素同时命中时只保留容器
    const filtered = targets.filter((target) => !targets.some((o) => o !== target && o.contains(target)));
    const beam = { from, dx, dy, range };
    const jobs = [];
    filtered.slice(0, maxTargets).forEach((el) => {
      const job = planBurn(el, from, to, width / 2, threshold, beam);
      if (job) jobs.push(job);
    });

    // 按目标在光柱上的投影位置排队：激光扫到哪个目标，哪里才出现痕迹
    const spread = durationMs * 0.7;
    state.laserBurns = jobs
      .map((job) => ({ ...job, at: t + spread * job.u }))
      .sort((a, b) => a.at - b.at);
  }

  // 按住类武器：枪口固定在按下点，按住期间朝光标方向持续生效
  function fireStep() {
    const f = state.firing;
    if (!f.active || !f.muzzle || !f.aim) return;

    const weapon = currentWeapon();
    if (!weapon || weapon.input !== 'hold') return;

    const params = HOLD_PARAMS[weapon.id] || HOLD_PARAMS.revolver;
    const t = now();
    if (t - f.lastShotAt < params.cooldown(CONFIG)) return;
    f.lastShotAt = t;

    fireBullet(f.muzzle, f.aim, {
      holeRadius: params.holeRadius(CONFIG),
      spread: params.spread(CONFIG),
      fire: params.fire,
    });
  }

  // 一颗子弹：沿枪口→光标做射线检测，命中最近的目标
  function fireBullet(muzzle, rawAim, options) {
    const opts = options || {};
    const spread = Number.isFinite(opts.spread) ? opts.spread : 0;
    const aim =
      spread > 0
        ? {
            x: rawAim.x + (Math.random() - 0.5) * 2 * spread,
            y: rawAim.y + (Math.random() - 0.5) * 2 * spread,
          }
        : rawAim;

    const dx = aim.x - muzzle.x;
    const dy = aim.y - muzzle.y;
    if (Math.hypot(dx, dy) < 4) return;

    const result = raycastTarget(muzzle, aim);
    const hitTarget = result ? result.target : null;
    const hitPoint = result ? result.point : null;
    const end = hitPoint || aim;

    // 弹道
    if (state.tracers.length > 40) state.tracers.shift();
    state.tracers.push({ x1: muzzle.x, y1: muzzle.y, x2: end.x, y2: end.y, alpha: 1 });

    sound.play(opts.fire || 'machinegunFire');
    state.shake = Math.max(state.shake, 0.22);

    // 机枪枪口火光：记录方向，绘制时按侧视画成锥形
    if (CONFIG.muzzleFlashEnabled !== false) {
      const len = Math.hypot(dx, dy) || 1;
      state.muzzleFlash = {
        x: muzzle.x,
        y: muzzle.y,
        dx: dx / len,
        dy: dy / len,
        until: now() + 70,
      };
    }

    if (hitTarget) {
      const radius = Number.isFinite(opts.holeRadius)
        ? opts.holeRadius
        : CONFIG.machinegunHoleRadius;
      holeDestroy(hitTarget, end.x, end.y, radius);
    } else {
      spawnSparks(
        state.particles,
        { left: end.x - 6, top: end.y - 6, width: 12, height: 12 },
        end,
        { x: dx, y: dy }
      );
    }
  }

  // 左轮：点一次打一枪，弹孔光滑并冒烟；打空后自动换弹
  function singleShotAt(x, y) {
    const t = now();
    if (t < state.reloadingUntil) return;
    if (t - state.lastFireAt < CONFIG.revolverCooldown) return;
    state.lastFireAt = t;

    let hit = null;
    try {
      const stack = document.elementsFromPoint(x, y) || [];
      for (const node of stack) {
        if (!node || node.nodeType !== 1) continue;
        if (node === state.canvas || node === document.documentElement || node === document.body) {
          continue;
        }
        if (node.hasAttribute && node.hasAttribute('data-adslash-ui')) continue;
        hit = node;
        break;
      }
    } catch (e) {}

    sound.play('revolverFire');
    state.shake = 0.6;
    state.shockwaves.push({ x, y, r: 10, alpha: 0.8 });

    // 抛壳：尺寸跟弹孔一致
    if (CONFIG.shellCasingsEnabled !== false) {
      spawnShell(state.particles, x, y, CONFIG.revolverHoleRadius);
    }

    // 消耗一发；打空后进入换弹
    state.chambers = Math.max(0, state.chambers - 1);
    if (state.chambers === 0) {
      sound.play('reload');
      state.reloadingUntil = t + CONFIG.revolverReloadMs;
      setTimeout(() => {
        state.chambers = Math.max(1, Math.floor(CONFIG.revolverChambers) || 6);
        state.reloadingUntil = 0;
      }, CONFIG.revolverReloadMs);
    }

    const target = hit
      ? findSlashTarget(hit, { config: CONFIG, marks: state.marks, canvas: state.canvas })
      : null;

    if (!target) {
      spawnSparks(
        state.particles,
        { left: x - 6, top: y - 6, width: 12, height: 12 },
        { x, y },
        { x: 1, y: 0 }
      );
      return;
    }

    holeDestroy(target, x, y, CONFIG.revolverHoleRadius, { smooth: true, smoke: true });
  }

  const saveMarks = () => {
    if (!storage || typeof storage.saveMarks !== 'function') return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      try {
        storage.saveMarks(state.marks.slice());
      } catch (e) {}
    }, 200);
  };

  function addMark(sel) {
    if (!sel) return;
    if (state.marks.includes(sel)) return;
    state.marks.push(sel);
    if (state.marks.length > 200) state.marks.splice(0, state.marks.length - 200);
    saveMarks();
  }

  function removeMark(sel) {
    const idx = state.marks.indexOf(sel);
    if (idx >= 0) {
      state.marks.splice(idx, 1);
      saveMarks();
    }
  }

  function hideEl(el) {
    try {
      el.style.setProperty(CONFIG.hideProp, CONFIG.hideValue, 'important');
    } catch (e) {}
  }

  function restoreEl(el, prevStyle) {
    try {
      if (prevStyle == null) el.removeAttribute('style');
      else el.setAttribute('style', prevStyle);
    } catch (e) {}
  }

  function slash(el, hitPoint, dir, entryPoint, flashTrail) {
    if (!el || state.pending.has(el) || state.slashed.has(el)) return;

    state.pending.add(el);
    const rect = el.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) {
      state.pending.delete(el);
      return;
    }

    if (flashTrail && flashTrail.length > 1) {
      state.flashes.push({ trail: flashTrail, hitPoint, alpha: 1, fade: 0.06 });
    }

    const sel = cssPath(el);
    const prevStyle = el.getAttribute('style');
    const record = { sel, prevStyle };

    try {
      hideEl(el);
      state.slashed.add(el);
      releaseLift(el);
      if (sel) addMark(sel);
      state.undoStack.push(record);
      if (state.undoStack.length > 20) state.undoStack.shift();

      // 白热刃口 Slash wipe：可选的刀斩击形态，生成失败时回退到经典两半散开
      let slashFx = null;
      if (CONFIG.bladeStyle === 'slash') {
        slashFx = spawnSlashWipeFragments(el, rect, entryPoint, dir, {
          durationMs: CONFIG.bladeFxDurationMs,
          hitStop: CONFIG.hitStop,
        });
        if (slashFx) {
          // 连续快速挥砍时只保留最近三个叠加层，避免刀线与火花堆满画布
          if (state.slashWipes.length >= 3) state.slashWipes.shift();
          state.slashWipes.push({ ...slashFx, t0: now() });
        }
      }
      if (!slashFx) {
        spawnDOMFragments(el, rect, hitPoint, dir, entryPoint, CONFIG.hitStop);
      }
      spawnSparks(state.particles, rect, hitPoint, dir);
      // 每命中一刀递进一档；超过五刀走中间三档循环
      state.bladeCutIndex += 1;
      sound.play(bladeSfxForCut(state.bladeCutIndex));

      state.slashCount++;
      onSlash({ el, rect, count: state.slashCount, weapon: CONFIG.weapon });
    } catch (e) {
      console.error(e);
      hideEl(el);
    }

    state.pending.delete(el);
  }

  // 炮/枪的摧毁：不做切线切分，直接在目标上挖洞
  function holeDestroy(el, cx, cy, holeRadius, options) {
    if (!el || state.pending.has(el) || state.slashed.has(el)) return;

    state.pending.add(el);
    const rect = el.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) {
      state.pending.delete(el);
      return;
    }

    const sel = cssPath(el);
    const prevStyle = el.getAttribute('style');

    try {
      hideEl(el);
      state.slashed.add(el);
      releaseLift(el);
      if (sel) addMark(sel);

      state.undoStack.push({ sel, prevStyle });
      if (state.undoStack.length > 20) state.undoStack.shift();

      const hole = Math.min(holeRadius, Math.max(rect.width, rect.height) * 0.75);

      if (options && options.breakup) {
        // 玻璃碎裂（Shatter wipe）：可选的炮破碎形态。生成失败时回退到经典放射裂纹
        let handled = false;
        if (CONFIG.cannonBreakStyle === 'shatter' && !(options && options.shatter === false)) {
          const durationMs = Math.max(400, Math.min(4000, Number(CONFIG.shatterDurationMs) || 1400));
          const pattern = spawnShatterWipe(el, rect, cx, cy, { durationMs, holeRadius: hole });
          if (pattern) {
            handled = true;
            // 一炮命中多个目标时只保留最近两个叠加层，避免裂纹与闪光成倍堆积
            if (state.shatterWipes.length >= 2) state.shatterWipes.shift();
            state.shatterWipes.push({ ...pattern, t0: now() });
            setTimeout(() => sound.play('cannonCrack'), durationMs * 0.16);
            setTimeout(() => sound.play('cannonBreak'), durationMs * 0.42);
          }
        }

        if (!handled) {
          // 炮：裂缝先不规则生长（带转折与分叉），长完再碎块崩开
          const started = spawnBlastCracks(el, rect, cx, cy, {
            holeRadius: hole,
            hitStop: CONFIG.hitStop,
            stepBase: Math.max(70, CONFIG.cutStepBase * 0.7),
            stepDecay: CONFIG.cutStepDecay,
            stepMin: CONFIG.cutStepMin,
            onCrack: () => sound.play('cannonCrack'),
            onDone: () => {
              const ok = spawnBlastBreakup(el, rect, cx, cy, {
                holeRadius: hole,
                hitStop: 0,
                stepBase: Math.max(50, CONFIG.cutStepBase * 0.5),
                stepDecay: CONFIG.cutStepDecay,
                stepMin: 30,
                onCrack: () => sound.play('cannonCrack'),
                onBurst: () => sound.play('cannonBreak'),
              });
              if (!ok) sound.play('cannonBreak');
            },
          });

          if (!started) {
            spawnBlastHole(el, rect, cx, cy, {
              holeRadius: hole,
              hitStop: CONFIG.hitStop,
              holdMs: CONFIG.blastHoleHold,
              crackWidth: CONFIG.crackWidth,
              crackLength: CONFIG.crackLength,
              crackStartWidth: CONFIG.crackStartWidth,
              crackEndWidth: CONFIG.crackEndWidth,
            });
            sound.play('cannonBreak');
          }
        }
      } else {
        spawnBlastHole(el, rect, cx, cy, {
          holeRadius: hole,
          hitStop: CONFIG.hitStop,
          holdMs: CONFIG.blastHoleHold,
          crackWidth: CONFIG.crackWidth,
          crackLength: CONFIG.crackLength,
          crackStartWidth: CONFIG.crackStartWidth,
          crackEndWidth: CONFIG.crackEndWidth,
          smooth: !!(options && options.smooth),
        });
      }

      spawnSparks(state.particles, rect, { x: cx, y: cy }, { x: 1, y: 0 });

      if (options && options.smoke) {
        spawnSmoke(state.particles, cx, cy, holeRadius);
      }

      // 破坏音效与开火音效分离
      if (CONFIG.weapon === 'revolver') sound.play('revolverHit');
      else if (CONFIG.weapon === 'machinegun') sound.play('machinegunHit');

      state.slashCount++;
      onSlash({ el, rect, count: state.slashCount, blast: true, weapon: CONFIG.weapon });
    } catch (e) {
      console.error(e);
      hideEl(el);
    }

    state.pending.delete(el);
  }

  // 累积一刀。同一目标可反复叠，松手后一次性切开
  function addCut(el, entry, hitPoint, dir, flashTrail) {
    let rec = state.lockedTargets.get(el);
    if (!rec) {
      rec = { rect: el.getBoundingClientRect(), cuts: [] };
      state.lockedTargets.set(el, rec);
    }

    if (rec.cuts.length >= CONFIG.maxCutsPerTarget) return;

    const last = rec.cuts[rec.cuts.length - 1];
    if (last) {
      const gap = Math.hypot(hitPoint.x - last.hitPoint.x, hitPoint.y - last.hitPoint.y);
      if (gap < CONFIG.minCutGap) return;
    }

    rec.cuts.push({ entry, hitPoint, dir, flashTrail });
  }

  // 松手后的完整流程：抬起 → 逐刀由慢到快 → 一次性炸开
  function executeCuts(el, rec) {
    if (!el || state.pending.has(el) || state.slashed.has(el)) {
      finishBatch();
      return;
    }

    const cuts = rec && rec.cuts ? rec.cuts : [];
    if (!cuts.length) {
      finishBatch();
      return;
    }

    if (cuts.length === 1) {
      const c = cuts[0];
      slash(el, c.hitPoint, c.dir, c.entry, c.flashTrail);
      finishBatch();
      return;
    }

    // 播放序列期间占位，避免同一目标被再次锁定而跑出两条序列
    state.pending.add(el);

    // 超过 3 刀才抬起；等过渡结束再取矩形，让刀线跟着元素走
    const willLift = cuts.length > 3;
    const strong = cuts.length >= 7;
    if (willLift) applyLift(el, strong ? 1.08 : 1.05, strong ? -16 : -10);

    setTimeout(
      () => {
        const rect = el.getBoundingClientRect();
        const mapped = mapCuts(cuts, rec.rect, rect);
        state.cutSequence = { cuts: mapped, index: 0 };
        runCutStep(el, rect, mapped, 0, () => explode(el, rect, mapped));
      },
      willLift ? 160 : 0
    );
  }

  // 记录时的屏幕坐标 → 当前矩形坐标（抬升/放大后仍然对齐）
  function mapCuts(cuts, from, to) {
    if (!from || !to || from.width < 1 || from.height < 1) return cuts;
    const sx = to.width / from.width;
    const sy = to.height / from.height;
    const map = (p) => ({
      x: to.left + (p.x - from.left) * sx,
      y: to.top + (p.y - from.top) * sy,
    });
    return cuts.map((c) => ({
      entry: map(c.entry),
      hitPoint: map(c.hitPoint),
      dir: { x: c.dir.x * sx, y: c.dir.y * sy },
      flashTrail: c.flashTrail,
    }));
  }

  // 逐刀落线：只推进亮线进度并出声，不做闪烁（频闪会让人不适）
  function runCutStep(el, rect, cuts, index, done) {
    if (index >= cuts.length) {
      done();
      return;
    }

    if (state.cutSequence) state.cutSequence.index = index + 1;
    // 起手已占第 1 刀，逐刀落线从第 2 刀开始；总刀数 = 起手 + 切线数，
    // 有总数才能让最后一刀落在「最后一击」
    sound.play(bladeSfxForCut(index + 2, cuts.length + 1));

    const gap = Math.max(
      CONFIG.cutStepMin,
      CONFIG.cutStepBase * Math.pow(CONFIG.cutStepDecay, index)
    );
    setTimeout(() => runCutStep(el, rect, cuts, index + 1, done), gap);
  }

  function explode(el, rect, cuts) {
    state.cutSequence = null;

    // 播放序列时已经占位了 pending，这里只判断是否已被处理过
    if (!el || state.slashed.has(el)) {
      state.pending.delete(el);
      finishBatch();
      return;
    }

    const sel = cssPath(el);
    const prevStyle = el.getAttribute('style');

    try {
      hideEl(el);
      state.slashed.add(el);
      releaseLift(el);
      if (sel) addMark(sel);

      state.undoStack.push({ sel, prevStyle });
      if (state.undoStack.length > 20) state.undoStack.shift();

      spawnMultiCutFragments(el, rect, cuts, CONFIG.hitStop);

      sound.play('bladeBreak');
      state.shockwaves.push({
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        r: Math.max(rect.width, rect.height) * 0.18,
        alpha: 1,
      });

      const last = cuts[cuts.length - 1];
      spawnSparks(state.particles, rect, last.hitPoint, last.dir);

      state.slashCount++;
      onSlash({ el, rect, count: state.slashCount, cuts: cuts.length, weapon: CONFIG.weapon });
    } catch (e) {
      console.error(e);
      hideEl(el);
    }

    state.pending.delete(el);
    finishBatch();
  }

  // 整批目标炸完后，白闪与震屏只来一次
  function finishBatch() {
    state.batchRemaining -= 1;
    if (state.batchRemaining > 0) return;
    state.batchRemaining = 0;
    state.flashWhite = 1;
    state.shake = 1;
  }

  function checkHits(x, y) {
    checkDomHits(x, y);
    if (CONFIG.comboCut) checkPieceHits(x, y);
  }

  // 连切：碎片进入/离开判定，与元素一致——从一侧进、另一侧出才算贯穿
  function checkPieceHits(x, y) {
    const hits = piecesAt(x, y, now());
    const stillInside = new Set();
    for (const item of hits) stillInside.add(item.id);

    for (const [id, entry] of state.pieceHits) {
      if (stillInside.has(id)) continue;

      state.pieceHits.delete(id);
      const item = getPiece(id);
      if (!item || !item.node.isConnected) continue;

      const rect = item.node.getBoundingClientRect();
      const dx = Math.abs(x - entry.x);
      const dy = Math.abs(y - entry.y);

      if (dx > rect.width * CONFIG.pierceRatio || dy > rect.height * CONFIG.pierceRatio) {
        spawnSparks(state.particles, rect, { x, y }, { x: x - entry.x, y: y - entry.y });
        reslicePiece(item, entry, { x, y }, 0, onSlash);
      }
    }

    for (const item of hits) {
      if (!state.pieceHits.has(item.id)) state.pieceHits.set(item.id, { x, y });
    }
  }

  function checkDomHits(x, y) {
    for (const [el, entry] of state.activeHits.entries()) {
      const rect = el.getBoundingClientRect();

      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
        const dx = Math.abs(x - entry.x);
        const dy = Math.abs(y - entry.y);

        if (dx > rect.width * CONFIG.pierceRatio || dy > rect.height * CONFIG.pierceRatio) {
          const hitPoint = { x, y };
          const dir = { x: x - entry.x, y: y - entry.y };

          const flashTrail = [];
          for (let i = 0; i < state.trail.length; i++) {
            flashTrail.push({ x: state.trail[i].x, y: state.trail[i].y });
          }

          if (CONFIG.executeOnRelease) {
            addCut(el, { x: entry.x, y: entry.y }, hitPoint, dir, flashTrail);
          } else {
            slash(el, hitPoint, dir, { x: entry.x, y: entry.y }, flashTrail);
          }
        }

        state.activeHits.delete(el);
      }
    }

    let stack;
    try {
      stack = document.elementsFromPoint(x, y);
    } catch (e) {
      return;
    }
    if (!stack || !stack.length) return;

    let hit = null;
    for (const n of stack) {
      if (!n || n.nodeType !== 1) continue;
      if (n === state.canvas || n === document.documentElement || n === document.body) continue;
      if (n.hasAttribute && n.hasAttribute('data-adslash-ui')) continue;
      hit = n;
      break;
    }
    if (!hit) return;

    const env = { config: CONFIG, marks: state.marks, canvas: state.canvas };
    const target = findSlashTarget(hit, env);
    // 已锁定的目标允许再次进入：这就是叠刀
    if (
      !target ||
      state.pending.has(target) ||
      state.slashed.has(target) ||
      state.activeHits.has(target)
    ) {
      return;
    }

    state.activeHits.set(target, { x, y });
  }

  function onPointerDown(e) {
    if (!state.active) return;

    const btn = state.closeBtn;
    if (
      btn &&
      e.clientX >= btn.x &&
      e.clientX <= btn.x + btn.w &&
      e.clientY >= btn.y &&
      e.clientY <= btn.y + btn.h
    ) {
      e.preventDefault();
      e.stopPropagation();
      deactivate();
      return;
    }

    if (e.button !== 0 && e.pointerType === 'mouse') return;

    const weapon = currentWeapon();

    // 蓄力类武器：按住充能，松手一次性发射
    if (weapon && weapon.implemented && weapon.input === 'charge') {
      e.preventDefault();
      const t = now();
      if (t < state.laserCooldownUntil) return;
      state.charging = { startAt: t, x: e.clientX, y: e.clientY };
      state.weaponSprite = {
        x: e.clientX,
        y: e.clientY,
        aimX: e.clientX,
        aimY: e.clientY,
        charge: 0,
        over: 0,
        recoil: 0,
        active: true,
        placed: true,
      };
      // 蓄力音用真实采样（7.03s，足够覆盖蓄力 + 过量段）；缺失时回落合成
      sound.play('laserCharge');
      return;
    }

    // 按住类武器：以按下点为枪口，按住期间持续射击
    if (weapon && weapon.implemented && weapon.input === 'hold') {
      e.preventDefault();
      state.firing.active = true;
      state.firing.muzzle = { x: e.clientX, y: e.clientY };
      state.firing.aim = { x: e.clientX, y: e.clientY };
      state.firing.lastShotAt = 0;
      return;
    }

    // 点击类武器：按下即开火，不进入拖动流程
    if (weapon && weapon.implemented && weapon.input === 'click') {
      e.preventDefault();
      if (weapon.id === 'cannon') blastAt(e.clientX, e.clientY);
      else if (weapon.id === 'revolver') singleShotAt(e.clientX, e.clientY);
      return;
    }

    // 放置类武器：点击放下，之后由渲染循环持续结算（黑洞）
    if (weapon && weapon.implemented && weapon.input === 'drop') {
      e.preventDefault();
      if (weapon.id === 'blackhole') placeBlackhole(e.clientX, e.clientY);
      return;
    }

    // 未实现的武器不响应输入
    if (!canSlash()) return;

    // 每次按下重置连斩计数：起手就是第 1 刀（单次挥砍音）
    state.bladeCutIndex = 1;
    sound.play(bladeSfxForCut(1));

    e.preventDefault();

    state.isDrawing = true;
    state.activeHits.clear();
    state.pieceHits.clear();
    releaseAllLifts();
    state.lockedTargets.clear();

    const pt = { x: e.clientX, y: e.clientY, t: now() };
    state.prevPoint = pt;
    state.trail.push(pt);
    if (state.trail.length > CONFIG.trailLength) state.trail.shift();
  }

  function onPointerMove(e) {
    // 射击时瞄准点跟随光标，不受 isDrawing 限制
    if (state.firing.active) {
      state.firing.aim = { x: e.clientX, y: e.clientY };
    }

    // 炮台只在 pointerdown 时重新就位，其余时间固定不动，只更新瞄准点。
    // 这样发射瞬间不会因为追赶光标而「向前挪一段」，预瞄也稳定。
    if (state.weaponSprite.active) {
      state.weaponSprite.aimX = e.clientX;
      state.weaponSprite.aimY = e.clientY;
    }
    if (state.charging) {
      state.charging.x = e.clientX;
      state.charging.y = e.clientY;
    }

    // 长按模式下的黑洞跟着光标走；如果指针已经松开（在窗口外放的情况），顺手收束
    if (state.blackholes[0] && state.blackholes[0].holding && e.buttons === 0) releaseBlackhole();
    followBlackhole(e.clientX, e.clientY);

    if (!state.active || !state.isDrawing) return;

    const pt = { x: e.clientX, y: e.clientY, t: now() };

    if (state.prevPoint) {
      const a = state.prevPoint;
      const b = pt;
      const dist = Math.hypot(b.x - a.x, b.y - a.y);

      if (dist > 1) {
        const steps = Math.max(1, Math.ceil(dist / CONFIG.sampleStep));
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          checkHits(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
        }
      }
    }

    state.prevPoint = pt;
    state.trail.push(pt);
    if (state.trail.length > CONFIG.trailLength) state.trail.shift();
  }

  function onPointerUp() {
    if (!state.active) return;

    state.firing.active = false;
    // 蓄力类：松手发射一次贯穿光柱
    if (state.charging) {
      const c = state.charging;
      state.charging = null;
      sound.stopHum();
      const chargeMs = Math.max(100, Number(CONFIG.laserChargeMs) || 1200);
      // 不封顶：超过 1 的部分就是过量蓄力，交给 fireLaser 换成额外宽度
      const ratio = (now() - c.startAt) / chargeMs;
      const s = state.weaponSprite;
      s.charge = Math.min(1, ratio);
      s.over = 0;
      s.recoil = 1;
      fireLaser({ x: s.x, y: s.y }, { x: c.x, y: c.y }, ratio);
    }
    releaseBlackhole();

    state.isDrawing = false;
    state.prevPoint = null;
    state.bladeCutIndex = 1; // 下次按下重新从第 1 刀开始
    state.activeHits.clear();
    state.pieceHits.clear();

    if (CONFIG.executeOnRelease && state.lockedTargets.size > 0) {
      const targets = Array.from(state.lockedTargets.entries());
      state.lockedTargets.clear();

      state.batchRemaining = targets.length;

      let delay = 0;
      for (let i = 0; i < targets.length; i++) {
        const [el, rec] = targets[i];
        setTimeout(() => executeCuts(el, rec), delay);
        delay += Math.max(50, 150 / (i + 1));
      }
    }
  }

  function onWheel(e) {
    // 只在按住左键划线时屏蔽滚动，否则长页面根本没法往下看
    if (state.active && state.isDrawing) e.preventDefault();
  }

  function onKeyDown(e) {
    if (state.active && e.key === 'Escape') {
      e.preventDefault();
      deactivate();
    }
  }

  function loop() {
    if (!state.active || !state.ctx) {
      state.rafId = null;
      return;
    }

    state.frames = (state.frames || 0) + 1;

    const ctx = state.ctx;
    ctx.clearRect(0, 0, state.cssW, state.cssH);

    const tNow = now();
    if (!state.isDrawing) {
      while (state.trail.length && tNow - state.trail[0].t > CONFIG.trailLifeMs + 40) {
        state.trail.shift();
      }
    }

    const shake = state.shake;
    const shaking = shake > 0.01;
    if (shaking) {
      ctx.save();
      ctx.translate((Math.random() - 0.5) * 12 * shake, (Math.random() - 0.5) * 12 * shake);
    }

    fireStep();
    stepBlackholes();

    drawTargetBoxes(ctx, state);
    drawBlackholes(ctx, state, CONFIG);
    drawEffects(ctx, state, CONFIG);
    drawShatterWipes(ctx, state);
    drawSlashWipes(ctx, state);

    // 激光炮：焦边在最底、光柱居中、炮台最上 —— 灼烧痕迹不能盖住激光本身
    const tFrame = now();
    const laserReady = !!(currentWeapon() && currentWeapon().id === 'laser');
    state.weaponSprite.active = laserReady;

    // 激光痕迹按光柱推进顺序逐个生效：激光扫到哪，哪里才出现痕迹
    if (state.laserBurns.length) {
      const due = [];
      const rest = [];
      for (const job of state.laserBurns) (job.at <= tFrame ? due : rest).push(job);
      if (due.length) {
        state.laserBurns = rest;
        for (const job of due) applyBurnJob(job);
      }
    }

    // 因果链：激光 → 激光痕迹（洞）→ 余温灼烧（glow）→ 永久灼烧痕迹（scar）。
    // 灼烧必须等光柱完全扫完才开始，灼烧程度越高余温持续越久。
    const columnMs = Math.max(200, Number(CONFIG.laserColumnMs) || 900);
    const burnK = clamp(Number(CONFIG.laserBurnIntensity) || 1, 0.3, 2);
    drawBurnEdges(
      ctx,
      activeBurnEdges(columnMs * (1.8 + 0.6 * burnK), columnMs * 1.0),
      tFrame
    );
    if (state.laserColumn) {
      if (tFrame - state.laserColumn.t0 > state.laserColumn.durationMs) state.laserColumn = null;
      else drawLaserColumn(ctx, state.laserColumn, tFrame, CONFIG);
    }
    if (laserReady) {
      if (state.charging) {
        const elapsed = tFrame - state.charging.startAt;
        const chargeMs = Math.max(100, Number(CONFIG.laserChargeMs) || 1200);
        const overMs = Math.max(100, Number(CONFIG.laserOverchargeMs) || 1200);
        // charge 可超过 1：炮台据此画第二圈过量指示
        state.weaponSprite.charge = elapsed / chargeMs;
        state.weaponSprite.over = clamp((elapsed - chargeMs) / overMs, 0, 1);
      } else {
        state.weaponSprite.charge *= 0.9;
        state.weaponSprite.over *= 0.9;
      }
      drawLaserEmitter(ctx, state.weaponSprite, CONFIG);
    }
    state.weaponSprite.recoil *= 0.88;

    drawTrail(ctx, state, CONFIG);
    updateParticles(ctx, state, (type) => sound.play(type));
    drawFiringGuide(ctx, state);
    drawTracers(ctx, state);
    drawMuzzleFlash(ctx, state);
    drawChambers(ctx, state, CONFIG);
    drawCloseButton(ctx, state);

    if (shaking) ctx.restore();
    state.shake *= 0.86;
    if (state.shake < 0.01) state.shake = 0;

    state.rafId = requestAnimationFrame(loop);
  }

  function resizeCanvas() {
    const c = state.canvas;
    if (!c) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;

    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    c.style.width = w + 'px';
    c.style.height = h + 'px';

    const ctx = c.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);

    state.dpr = dpr;
    state.cssW = w;
    state.cssH = h;
    state.ctx = ctx;
  }

  function bind(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    state.listeners.push({ target, type, fn, opts });
  }

  function createCanvas() {
    const c = document.createElement('canvas');
    c.dataset.adslashUi = '1';
    Object.assign(c.style, {
      position: 'fixed',
      left: '0',
      top: '0',
      zIndex: '2147483647',
      pointerEvents: 'auto',
      cursor: 'crosshair',
      touchAction: 'none',
      background: 'transparent',
      display: 'block',
    });

    const root = document.documentElement || document.body;
    if (!root) return;
    root.appendChild(c);

    state.canvas = c;
    resizeCanvas();

    bind(c, 'pointermove', onPointerMove, { passive: true });
    bind(c, 'pointerdown', onPointerDown, { passive: false });
    bind(c, 'pointerup', onPointerUp, { passive: true });
    bind(c, 'pointercancel', onPointerUp, { passive: true });
    bind(c, 'wheel', onWheel, { passive: false });
    bind(window, 'resize', resizeCanvas, { passive: true });
    bind(window, 'keydown', onKeyDown, { passive: false });
  }

  function destroyCanvas() {
    if (state.rafId) {
      cancelAnimationFrame(state.rafId);
      state.rafId = null;
    }
    for (const l of state.listeners) l.target.removeEventListener(l.type, l.fn, l.opts);
    state.listeners = [];

    if (state.canvas && state.canvas.parentNode) state.canvas.parentNode.removeChild(state.canvas);

    state.canvas = null;
    state.ctx = null;
    state.trail = [];
    state.flashes = [];
    state.particles = [];
    state.shatterWipes = [];
    state.slashWipes = [];
    state.charging = null;
    state.laserColumn = null;
    state.laserBurns = [];
    state.weaponSprite.active = false;
    clearBurns();
    sound.stopHum();
    state.prevPoint = null;
    state.closeBtn = null;
  }

  function applyMarks() {
    if (!document.body) return;
    if (!state.marks.length) return;

    for (const sel of state.marks) {
      let nodes;
      try {
        nodes = document.querySelectorAll(sel);
      } catch (e) {
        continue;
      }
      for (const el of nodes) {
        if (state.slashed.has(el)) continue;
        hideEl(el);
        state.slashed.add(el);
      }
    }
  }

  function startObserver() {
    if (state.observer || !document.body) return;

    let timer = null;
    const obs = new MutationObserver(() => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        if (state.active) applyMarks();
      }, 120);
    });

    obs.observe(document.body, { childList: true, subtree: true });
    state.observer = obs;
  }

  function stopObserver() {
    if (state.observer) {
      state.observer.disconnect();
      state.observer = null;
    }
  }

  function activate() {
    if (state.active) return;

    state.active = true;
    createCanvas();
    startObserver();
    if (!state.rafId) state.rafId = requestAnimationFrame(loop);

    onStateChange(true);
  }

  function deactivate() {
    if (!state.active) return;

    state.active = false;
    stopObserver();
    releaseAllLifts();
    state.cutSequence = null;
    state.firing.active = false;
    state.firing.muzzle = null;
    state.tracers = [];
    clearBlackholes();
    destroyCanvas();

    onStateChange(false);
  }

  function toggle() {
    if (state.active) deactivate();
    else activate();
  }

  function undoLast() {
    const rec = state.undoStack.pop();
    if (!rec) return false;

    removeMark(rec.sel);

    let el = null;
    try {
      el = document.querySelector(rec.sel);
    } catch (e) {
      el = null;
    }

    if (el) {
      restoreEl(el, rec.prevStyle);
      state.slashed.delete(el);
    }
    return true;
  }

  function clearMarks() {
    state.marks.length = 0;
    if (storage && typeof storage.clearMarks === 'function') {
      try {
        storage.clearMarks();
      } catch (e) {}
    } else {
      saveMarks();
    }
  }

  function setConfig(patch) {
    if (!patch) return CONFIG;

    for (const key of Object.keys(patch)) {
      if (!(key in DEFAULT_CONFIG)) continue;
      const value = patch[key];
      if (key === 'targetSizeLevel') {
        if (SIZE_LEVELS.indexOf(value) === -1) continue;
      }
      if (key === 'blackholeStyle') {
        if (BLACKHOLE_STYLES.indexOf(value) === -1) continue;
      }
      if (key === 'cannonBreakStyle') {
        if (CANNON_BREAK_STYLES.indexOf(value) === -1) continue;
      }
      if (key === 'bladeStyle') {
        if (BLADE_STYLES.indexOf(value) === -1) continue;
      }
      if (key === 'laserStyle') {
        if (LASER_STYLES.indexOf(value) === -1) continue;
      }
      if (key === 'laserSoundStyle') {
        if (LASER_SOUND_STYLES.indexOf(value) === -1) continue;
      }
      // 换武器统一走 setWeapon：补弹仓、收掉残留黑洞都在这条路径上
      if (key === 'weapon') {
        if (value !== CONFIG.weapon) setWeapon(value);
        continue;
      }
      CONFIG[key] = value;
    }

    if (state.active) {
      applyMarks();
    }
    return CONFIG;
  }

  function getConfig() {
    return CONFIG;
  }

  const ready = (async () => {
    if (storage && typeof storage.loadMarks === 'function') {
      try {
        const saved = await storage.loadMarks();
        if (Array.isArray(saved)) state.marks = saved.slice(-200);
      } catch (e) {}
    }

    if (CONFIG.autoApplyMarks) {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', applyMarks, { once: true });
      } else {
        applyMarks();
      }
    }
  })();

  function destroy() {
    deactivate();
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
      if (storage && typeof storage.saveMarks === 'function') {
        try {
          storage.saveMarks(state.marks.slice());
        } catch (e) {}
      }
    }
  }

  // 配置器预览：可单独播放声音 / 特效 / 滤镜，或触发一次真实攻击
  function preview(x, y, kind) {
    const weapon = currentWeapon();
    if (!weapon) return { ok: false, reason: 'no-weapon' };

    // 视口外的坐标拿不到命中元素
    if (kind !== 'sound' && (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight)) {
      return { ok: false, reason: 'out-of-view' };
    }

    if (kind === 'sound') {
      if (weapon.id === 'blade') sound.play('bladeSwing');
      else if (weapon.id === 'cannon') sound.play('cannonFire');
      else if (weapon.id === 'revolver') sound.play('revolverFire');
      else if (weapon.id === 'machinegun') sound.play('machinegunFire');
      else if (weapon.id === 'laser') {
        sound.play('laserFire');
        sound.play('laserHit');
      }
      else if (weapon.id === 'blackhole') {
        sound.play('blackholeOpen');
        sound.play('blackholeHum');
        sound.play('blackholeEat');
      } else sound.play('bladeSwing');
      return { ok: true, weapon: weapon.id };
    }

    if (kind === 'filter') {
      let hit = null;
      try {
        const stack = document.elementsFromPoint(x, y) || [];
        for (const node of stack) {
          if (!node || node.nodeType !== 1) continue;
          if (node === state.canvas || node === document.documentElement || node === document.body) {
            continue;
          }
          if (node.hasAttribute && node.hasAttribute('data-adslash-ui')) continue;
          hit = node;
          break;
        }
      } catch (e) {}

      if (!hit) return { ok: false, reason: 'no-element' };

      const filter = weapon.hitFilter || 'brightness(2.4) contrast(1.5)';
      const prevFilter = hit.style.filter;
      const prevTransition = hit.style.transition;
      hit.style.transition = 'filter 0.18s ease-out';
      hit.style.filter = filter;
      setTimeout(() => {
        hit.style.filter = prevFilter || '';
        setTimeout(() => {
          hit.style.transition = prevTransition || '';
        }, 220);
      }, 90);
      return { ok: true, weapon: weapon.id };
    }

    if (!state.active) activate();

    if (kind === 'effect') {
      state.shockwaves.push({ x, y, r: 8, alpha: 1 });
      spawnSparks(
        state.particles,
        { left: x - 12, top: y - 12, width: 24, height: 24 },
        { x, y },
        { x: 1, y: 0 }
      );
      if (weapon.id === 'revolver') spawnSmoke(state.particles, x, y, CONFIG.revolverHoleRadius);
      return { ok: true, weapon: weapon.id };
    }

    if (kind === 'attack') {
      if (weapon.id === 'cannon') blastAt(x, y);
      else if (weapon.id === 'revolver') singleShotAt(x, y);
      else if (weapon.id === 'blackhole') {
        // 预览时不能一直处于「按住」状态，放完自动收束
        placeBlackhole(x, y);
        setTimeout(() => releaseBlackhole(), 700);
      } else if (weapon.id === 'machinegun') {
        fireBullet(
          { x: Math.max(4, x - 160), y },
          { x, y },
          { holeRadius: CONFIG.machinegunHoleRadius, spread: 0 }
        );
      } else if (weapon.id === 'laser') {
        // 预览时直接以满蓄力发射一次贯穿光柱
        const from = { x: Math.max(4, x - 260), y };
        state.weaponSprite = { x: from.x, y: from.y, aimX: x, aimY: y, charge: 1, recoil: 1, active: true };
        state.laserCooldownUntil = 0;
        fireLaser(from, { x, y }, 1);
      } else {
        let hit = null;
        try {
          const stack = document.elementsFromPoint(x, y) || [];
          for (const node of stack) {
            if (!node || node.nodeType !== 1) continue;
            if (node === state.canvas || node === document.documentElement) continue;
            if (node.hasAttribute && node.hasAttribute('data-adslash-ui')) continue;
            hit = node;
            break;
          }
        } catch (e) {}
        if (hit) slash(hit, { x, y }, { x: 1, y: 0 }, { x, y }, []);
      }
      return { ok: true, weapon: weapon.id };
    }

    return { ok: false, reason: 'unknown-kind' };
  }

  return {
    ready,
    activate,
    deactivate,
    toggle,
    isActive: () => state.active,
    setConfig,
    getConfig,
    undoLast,
    clearMarks,
    getMarkCount: () => state.marks.length,
    getSlashCount: () => state.slashCount,
    // 武器框架
    getWeapons: () => WEAPONS,
    getWeapon: () => currentWeapon(),
    setWeapon,
    preview,
    // 配置器试听：直接播放某个命名音效
    playSfx: (name) => sound.play(name),
    // 调试/自检用：不参与游戏逻辑
    getDebugState: () => ({
      active: state.active,
      drawing: state.isDrawing,
      weapon: CONFIG.weapon,
      chambers: state.chambers,
      shells: state.particles.filter((p) => p.isShell).length,
      blackholes: state.blackholes.length,
      frames: state.frames || 0,
      blackholeRadius: state.blackholes[0] ? Math.round(state.blackholes[0].radius) : 0,
      blackholeAt: state.blackholes[0]
        ? { x: Math.round(state.blackholes[0].x), y: Math.round(state.blackholes[0].y) }
        : null,
      activeHits: state.activeHits.size,
      locked: state.lockedTargets.size,
      cuts: Array.from(state.lockedTargets.values()).map((r) => (r.cuts ? r.cuts.length : 0)),
    }),
    destroy,
  };
}
