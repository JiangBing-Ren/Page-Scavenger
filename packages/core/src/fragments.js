import { MEDIA_SELECTOR } from './config.js';
import { getSplitPolygons, polygonArea, ensureWinding } from './geometry.js';
import {
  registerPiece,
  unregisterPiece,
  splitPolygon,
  screenToLocal,
} from './pieces.js';

// 再切后单块面积下限，低于它就不再分，避免无限碎片
const MIN_PIECE_AREA = 60;

export function spawnSparks(particles, rect, hitPoint, dir) {
  const len = Math.hypot(dir.x, dir.y);
  if (len === 0) return;

  const dx = dir.x / len;
  const dy = dir.y / len;
  const nx = -dy;
  const ny = dx;

  const count = 60;
  for (let i = 0; i < count; i++) {
    const dist = (Math.random() - 0.5) * Math.max(rect.width, rect.height) * 0.8;
    const cx = hitPoint.x + dx * dist;
    const cy = hitPoint.y + dy * dist;
    const side = Math.random() > 0.5 ? 1 : -1;
    const vSpeed = Math.random() * 15 + 8;

    particles.push({
      x: cx,
      y: cy,
      vx: nx * side * vSpeed + (Math.random() - 0.5) * 10,
      vy: ny * side * vSpeed + (Math.random() - 0.5) * 10 - 5,
      size: Math.random() * 3 + 1,
      color: Math.random() > 0.8 ? '#ffffff' : Math.random() > 0.5 ? '#00ffcc' : '#ffcc00',
      life: 1,
      decay: Math.random() * 0.03 + 0.015,
      isChunk: false,
    });
  }

  const chunkCount = 10;
  for (let i = 0; i < chunkCount; i++) {
    const side = Math.random() > 0.5 ? 1 : -1;
    particles.push({
      x: hitPoint.x + (Math.random() - 0.5) * rect.width,
      y: hitPoint.y + (Math.random() - 0.5) * rect.height,
      vx: nx * side * (Math.random() * 10 + 5),
      vy: Math.random() * 10 - 5,
      size: Math.random() * 8 + 4,
      color: Math.random() > 0.5 ? 'rgba(200,200,200,0.8)' : 'rgba(150,200,255,0.8)',
      life: 1,
      decay: Math.random() * 0.01 + 0.005,
      isChunk: true,
    });
  }
}

// 左轮抛壳：小铜壳向右上弹出后掉落
export function spawnShell(particles, x, y, size) {
  // 抛壳口在枪身：光标左下方；尺寸跟弹孔一致，才看得清
  const ox = x - 30 - Math.random() * 10;
  const oy = y + 14 + Math.random() * 8;
  const len = Math.max(12, Number(size) || 34);

  particles.push({
    x: ox,
    y: oy,
    vx: 4 + Math.random() * 4,
    vy: -9 - Math.random() * 4,
    size: len,
    color: 'rgba(248, 206, 96, 1)',
    life: 1,
    decay: 0.0045,
    spin: Math.random() * Math.PI,
    isShell: true,
  });
}

// 弹孔升腾的烟雾（左轮）：颗粒更小更密，只轻轻上浮
export function spawnSmoke(particles, cx, cy, radius) {
  const count = 26;
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = Math.random() * radius * 0.55;
    particles.push({
      x: cx + Math.cos(angle) * dist,
      y: cy + Math.sin(angle) * dist,
      vx: (Math.random() - 0.5) * 6,
      vy: -3 - Math.random() * 8,
      size: radius * (0.1 + Math.random() * 0.16),
      color: 'rgba(212, 212, 212, 0.3)',
      life: 1,
      decay: 0.009 + Math.random() * 0.008,
      isSmoke: true,
    });
  }
}

// 炮击第一阶段：裂缝从弹着点不规则生长（带转折与分叉），按下标逐段显形；
// 生长结束后交给 onDone，由调用方接着做碎块崩开。
export function spawnBlastCracks(el, rect, centerX, centerY, options) {
  const opts = options || {};
  const hitStop = Number.isFinite(opts.hitStop) ? opts.hitStop : 0;
  const stepBase = Number.isFinite(opts.stepBase) ? opts.stepBase : 110;
  const stepDecay = Number.isFinite(opts.stepDecay) ? opts.stepDecay : 0.75;
  const stepMin = Number.isFinite(opts.stepMin) ? opts.stepMin : 40;

  const oversized = rect.width > window.innerWidth || rect.height > window.innerHeight;

  let box = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  if (oversized) box = visibleBox(rect);
  if (box.width < 4 || box.height < 4) return false;

  const clamp = (v, min, max) => Math.min(Math.max(v, min), max);
  const lx = clamp(centerX - box.left, 0, box.width);
  const ly = clamp(centerY - box.top, 0, box.height);
  const r = Math.max(10, Number(opts.holeRadius) || 60);

  const full = [
    { x: 0, y: 0 },
    { x: box.width, y: 0 },
    { x: box.width, y: box.height },
    { x: 0, y: box.height },
  ];

  const oriented = (points) => ensureWinding(points, true);
  const toSubpath = (points) =>
    'M' + points.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L') + ' Z';

  // 弹着点的锯齿洞
  const holePoints = [];
  const segs = 16;
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const jitter = 0.68 + Math.random() * 0.62;
    holePoints.push({
      x: lx + Math.cos(a) * r * jitter,
      y: ly + Math.sin(a) * r * jitter,
    });
  }
  const holePath = toSubpath(oriented(holePoints));

  // 折线加宽成 ribbon
  const toRibbon = (points, widths) => {
    const left = [];
    const right = [];
    for (let i = 0; i < points.length; i++) {
      const prev = points[i - 1] || points[i];
      const next = points[i + 1] || points[i];
      let dx = next.x - prev.x;
      let dy = next.y - prev.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const half = Math.max(0.6, widths[i] / 2);
      left.push({ x: points[i].x + nx * half, y: points[i].y + ny * half });
      right.push({ x: points[i].x - nx * half, y: points[i].y - ny * half });
    }
    return [...left, ...right.reverse()];
  };

  // 递归生成裂缝（随机转折 + 分叉），按生成顺序排队
  const crackPolys = [];
  const grow = (origin, angle, length, width, depth) => {
    const steps = 4 + Math.floor(Math.random() * 3);
    const points = [origin];
    const stepLen = length / steps;
    const curvature = (Math.random() - 0.5) * 1.5;
    const jitter = 0.25 + Math.random() * 0.5;

    let a = angle;
    let x = origin.x;
    let y = origin.y;

    for (let i = 0; i < steps; i++) {
      a += curvature / steps + (Math.random() - 0.5) * jitter;
      x += Math.cos(a) * stepLen;
      y += Math.sin(a) * stepLen;
      points.push({ x, y });
    }

    const taper = 0.6 + Math.random();
    const widths = points.map((_, i) => {
      const t = i / (points.length - 1);
      return Math.max(1, width * Math.pow(1 - t, taper));
    });

    crackPolys.push(oriented(toRibbon(points, widths)));

    if (depth <= 0) return;

    const branches = Math.random() > 0.45 ? 2 : 1;
    for (let b = 0; b < branches; b++) {
      const idx = 1 + Math.floor(Math.random() * Math.max(1, points.length - 2));
      const p = points[idx];
      const side = Math.random() > 0.5 ? 1 : -1;
      grow(
        p,
        a + side * (0.5 + Math.random() * 0.6),
        length * (0.3 + Math.random() * 0.3),
        widths[idx] * 0.65,
        depth - 1
      );
    }
  };

  const mains = 3 + Math.floor(Math.random() * 2); // 3~4 条主线
  const baseAngle = Math.random() * Math.PI * 2;
  for (let i = 0; i < mains; i++) {
    const angle = baseAngle + (i / mains) * Math.PI * 2 + (Math.random() - 0.5) * 0.7;
    const startR = r * (0.7 + Math.random() * 0.2);
    grow(
      { x: lx + Math.cos(angle) * startR, y: ly + Math.sin(angle) * startR },
      angle,
      r * (0.9 + Math.random() * 1.3),
      Math.max(4, r * 0.16),
      1
    );
  }

  if (!crackPolys.length) return false;

  const build = makeBuilder(el, rect, box, oversized, 'brightness(1.5) contrast(1.45)');
  const node = build(full);

  // 每次显形都重建遮罩：外框 + 洞 + 已长出的裂缝
  const applyMask = (count) => {
    const path =
      `M0 0 H${box.width.toFixed(1)} V${box.height.toFixed(1)} H0 Z ${holePath} ` +
      crackPolys.slice(0, count).map(toSubpath).join(' ');
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${box.width}" height="${box.height}">` +
      `<path d="${path}" fill="#fff"/></svg>`;
    const url = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
    node.style.maskImage = url;
    node.style.webkitMaskImage = url;
    node.style.maskRepeat = 'no-repeat';
    node.style.maskSize = '100% 100%';
  };

  applyMask(1);

  // 命中瞬间亮一下
  node.style.transition = 'filter 0.2s ease-out';
  setTimeout(() => {
    node.style.filter = 'none';
  }, 70);

  // 由慢到快逐段长出裂缝
  let delay = hitStop + 60;
  const perStage = Math.max(1, Math.ceil(crackPolys.length / 5));

  for (let i = perStage; i <= crackPolys.length; i += perStage) {
    const at = delay;
    setTimeout(() => {
      applyMask(i);
      if (typeof opts.onCrack === 'function') opts.onCrack();
    }, at);
    delay += Math.max(stepMin, stepBase * Math.pow(stepDecay, i / perStage));
  }

  setTimeout(() => {
    if (node.parentNode) node.parentNode.removeChild(node);
    if (typeof opts.onDone === 'function') opts.onDone();
  }, delay + 80);

  return true;
}

// 炮击：从弹着点切出多条贯穿到边缘的裂缝，把目标碎成多块，
// 再按由慢到快的节奏逐块崩开，最后整体炸散。
export function spawnBlastBreakup(el, rect, centerX, centerY, options) {
  const opts = options || {};
  const hitStop = Number.isFinite(opts.hitStop) ? opts.hitStop : 0;
  const stepBase = Number.isFinite(opts.stepBase) ? opts.stepBase : 110;
  const stepDecay = Number.isFinite(opts.stepDecay) ? opts.stepDecay : 0.72;
  const stepMin = Number.isFinite(opts.stepMin) ? opts.stepMin : 35;

  const oversized = rect.width > window.innerWidth || rect.height > window.innerHeight;

  let box = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  if (oversized) box = visibleBox(rect);
  if (box.width < 4 || box.height < 4) return false;

  const clamp = (v, min, max) => Math.min(Math.max(v, min), max);
  const lx = clamp(centerX - box.left, 0, box.width);
  const ly = clamp(centerY - box.top, 0, box.height);

  const full = [
    { x: 0, y: 0 },
    { x: box.width, y: 0 },
    { x: box.width, y: box.height },
    { x: 0, y: box.height },
  ];

  // 1) 以弹着点为中心做 3~4 条切割线，切出多块
  let pieces = [{ poly: full }];
  const cutCount = 3 + Math.floor(Math.random() * 2);
  const baseAngle = Math.random() * Math.PI;

  for (let i = 0; i < cutCount; i++) {
    const angle = baseAngle + (i / cutCount) * Math.PI + (Math.random() - 0.5) * 0.6;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const next = [];

    for (const piece of pieces) {
      const { left, right } = splitPolygon(piece.poly, { x: lx, y: ly }, dx, dy);
      for (const poly of [left, right]) {
        if (poly.length >= 3 && polygonArea(poly) >= 40) next.push({ poly });
      }
    }

    pieces = next;
  }

  if (pieces.length < 2) return false;

  const build = makeBuilder(el, rect, box, oversized, 'brightness(3.2) contrast(1.6) saturate(0.8)');

  // 2) 圆孔遮罩（炮的弹着点）
  const holeRadius = Math.max(8, Number(opts.holeRadius) || 60);
  const segments = 16;
  const holePoints = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const jitter = 0.68 + Math.random() * 0.62;
    holePoints.push({
      x: lx + Math.cos(a) * holeRadius * jitter,
      y: ly + Math.sin(a) * holeRadius * jitter,
    });
  }

  const holePath =
    'M' + holePoints.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L') + ' Z';
  const maskSvg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${box.width}" height="${box.height}">` +
    `<path d="M0 0 H${box.width.toFixed(1)} V${box.height.toFixed(1)} H0 Z ${holePath}" ` +
    `fill="#fff" fill-rule="evenodd"/></svg>`;
  const maskUrl = `url("data:image/svg+xml,${encodeURIComponent(maskSvg)}")`;

  // 3) 生成碎块
  const nodes = pieces.map(({ poly }) => {
    const node = build(poly);
    node.style.maskImage = maskUrl;
    node.style.webkitMaskImage = maskUrl;
    node.style.maskSize = '100% 100%';
    node.style.maskRepeat = 'no-repeat';

    let sx = 0;
    let sy = 0;
    for (const p of poly) {
      sx += p.x;
      sy += p.y;
    }

    return { node, cx: sx / poly.length, cy: sy / poly.length };
  });

  const centroidDir = (item) => {
    let vx = item.cx - lx;
    let vy = item.cy - ly;
    const d = Math.hypot(vx, vy) || 1;
    return { x: vx / d, y: vy / d };
  };

  // 4) 由慢到快逐块裂开（与刀的逐刀节奏一致）
  let delay = hitStop;
  nodes.forEach((item, index) => {
    const dir = centroidDir(item);
    const at = delay;
    delay += Math.max(stepMin, stepBase * Math.pow(stepDecay, index));

    setTimeout(() => {
      item.node.style.transition = 'transform 0.16s ease-out';
      item.node.style.transform =
        `translate3d(${dir.x * 3}px, ${dir.y * 3}px, 0) rotate(${(Math.random() - 0.5) * 2}deg)`;
      if (typeof opts.onCrack === 'function') opts.onCrack(index + 1);
    }, at);
  });

  // 5) 全部裂开后整体炸散
  setTimeout(() => {
    if (typeof opts.onBurst === 'function') opts.onBurst();
    for (const item of nodes) {
      const dir = centroidDir(item);
      const power = 190 + Math.random() * 200;
      animate(item.node, {
        tx: dir.x * power,
        ty: dir.y * power + 260,
        rot: (Math.random() - 0.5) * 260,
        axis: Math.random() > 0.5 ? 1 : -1,
        hitStop: 0,
      });
    }
  }, delay + 140);

  return true;
}

// iframe / video / canvas 克隆后是空白，用同尺寸色块替代，避免碎片出现空洞
function cloneForFragment(el) {
  const clone = el.cloneNode(true);
  const originals = el.querySelectorAll(MEDIA_SELECTOR);
  const clones = clone.querySelectorAll(MEDIA_SELECTOR);

  for (let i = 0; i < clones.length && i < originals.length; i++) {
    const src = originals[i];
    const dst = clones[i];
    if (!dst.parentNode) continue;

    const r = src.getBoundingClientRect();
    const cs = window.getComputedStyle(src);
    const ph = document.createElement('div');

    ph.style.width = r.width + 'px';
    ph.style.height = r.height + 'px';
    if (cs.display === 'inline') ph.style.display = 'inline-block';
    ph.style.borderRadius = cs.borderRadius;
    ph.style.background =
      cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)'
        ? cs.backgroundColor
        : 'linear-gradient(135deg, #2b3240, #1b202b)';

    dst.parentNode.replaceChild(ph, dst);
  }

  clone.querySelectorAll('script').forEach((n) => n.remove());
  return clone;
}

function baseStyleFor(left, top, width, height) {
  return {
    position: 'fixed',
    left: left + 'px',
    top: top + 'px',
    width: width + 'px',
    height: height + 'px',
    margin: '0',
    boxSizing: 'border-box',
    pointerEvents: 'none',
    zIndex: '2147483645',
    transformOrigin: 'center center',
    overflow: 'hidden',
    willChange: 'transform, opacity',
  };
}

export function visibleBox(rect) {
  const left = Math.max(rect.left, 0);
  const top = Math.max(rect.top, 0);
  const right = Math.min(rect.right, window.innerWidth);
  const bottom = Math.min(rect.bottom, window.innerHeight);
  return {
    left,
    top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

function polygonToCss(poly) {
  return poly.map((p) => `${p.x.toFixed(1)}px ${p.y.toFixed(1)}px`).join(',');
}

// 生成一个「给定局部多边形就能画出碎片」的构造器，重切时复用同一份
function makeBuilder(el, rect, box, oversized, filterStr) {
  return function build(poly) {
    const clip = `polygon(${polygonToCss(poly)})`;

    if (!oversized) {
      const node = cloneForFragment(el);
      node.removeAttribute('id');
      node.setAttribute('data-adslash-ui', '1');
      Object.assign(node.style, baseStyleFor(box.left, box.top, box.width, box.height), {
        clipPath: clip,
        filter: filterStr,
      });
      node.style.setProperty('visibility', 'visible', 'important');
      document.body.appendChild(node);
      return node;
    }

    const wrapper = document.createElement('div');
    wrapper.setAttribute('data-adslash-ui', '1');
    Object.assign(wrapper.style, baseStyleFor(box.left, box.top, box.width, box.height), {
      clipPath: clip,
      filter: filterStr,
      background: 'transparent',
    });

    const clone = cloneForFragment(el);
    clone.removeAttribute('id');
    Object.assign(clone.style, {
      position: 'fixed',
      left: rect.left - box.left + 'px',
      top: rect.top - box.top + 'px',
      width: rect.width + 'px',
      height: rect.height + 'px',
      margin: '0',
      boxSizing: 'border-box',
      pointerEvents: 'none',
    });
    clone.style.setProperty('visibility', 'visible', 'important');

    wrapper.appendChild(clone);
    document.body.appendChild(wrapper);
    return wrapper;
  };
}

function animate(node, options) {
  const { nx, speedX, tx, ty, rot, axis, hitStop, fromTransform, fromOpacity } = options;

  // 默认沿用「横向散开 + 向下坠落」；爆破会直接给 tx/ty 做径向飞散
  const dx = Number.isFinite(tx) ? tx : nx * speedX;
  const dy = Number.isFinite(ty) ? ty : 600;

  const run = () => {
    if (fromTransform) {
      node.style.transform = fromTransform;
      if (fromOpacity != null) node.style.opacity = String(fromOpacity);
      void node.offsetWidth;
    }

    const trans =
      'transform 1.2s cubic-bezier(0.3, 0.1, 0.6, 1), opacity 0.6s ease-in 0.6s, filter 0.2s';

    Object.assign(node.style, {
      transition: trans,
      transform: `translate3d(${dx}px, ${dy}px, 0) rotate3d(1, ${axis}, 0, ${rot}deg)`,
      opacity: '0',
      filter: 'none',
    });

    setTimeout(() => {
      unregisterPiece(node);
      if (node.parentNode) node.parentNode.removeChild(node);
    }, 1600);
  };

  if (hitStop > 0) setTimeout(run, hitStop);
  else run();
}

// 爆破：从弹着点不规则裂开 —— 锯齿状洞口 + 放射裂纹 + 四周飞散的碎块
export function spawnBlastHole(el, rect, centerX, centerY, options) {
  const opts = options || {};
  const hitStop = Number.isFinite(opts.hitStop) ? opts.hitStop : 0;
  const holdMs = opts.holdMs;

  // 裂缝形态参数（以洞口半径为基准）
  const crackWidth = Number.isFinite(opts.crackWidth) ? opts.crackWidth : 0.14;
  const crackLength = Number.isFinite(opts.crackLength) ? opts.crackLength : 1;
  const crackStartWidth = Number.isFinite(opts.crackStartWidth) ? opts.crackStartWidth : 1.1;
  const crackEndWidth = Number.isFinite(opts.crackEndWidth) ? opts.crackEndWidth : 0.25;

  const oversized = rect.width > window.innerWidth || rect.height > window.innerHeight;

  let box = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  if (oversized) {
    box = visibleBox(rect);
  }
  if (box.width < 4 || box.height < 4) return false;

  const full = [
    { x: 0, y: 0 },
    { x: box.width, y: 0 },
    { x: box.width, y: box.height },
    { x: 0, y: box.height },
  ];

  // 命中瞬间的强滤镜：提亮 + 提对比 + 轻微去饱和，制造冲击感
  const build = makeBuilder(el, rect, box, oversized, 'brightness(3.4) contrast(1.7) saturate(0.75)');
  const node = build(full);

  // 遮罩坐标以 node 自身的左上角为原点（超大元素时 node 是包装层，仍是同一原点）
  const lx = Math.min(Math.max(centerX - box.left, 0), box.width);
  const ly = Math.min(Math.max(centerY - box.top, 0), box.height);
  const r = Math.max(8, Number(opts.holeRadius) || 60);

  // 多边形绕向必须与外框相反，nonzero 填充下才能真正挖空
  const oriented = (points) => ensureWinding(points, true);

  const toSubpath = (points) =>
    'M' + points.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L') + ' Z';

  // 1) 洞口：默认带随机抖动；左轮用光滑圆孔
  const smooth = !!opts.smooth;
  const segments = smooth ? 24 : 16;
  const holePoints = [];
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    const jitter = smooth ? 1 : 0.68 + Math.random() * 0.62;
    holePoints.push({
      x: lx + Math.cos(angle) * r * jitter,
      y: ly + Math.sin(angle) * r * jitter,
    });
  }

  // 2) 裂缝：递归生长，每段随机转折并分叉，像真实裂开的纹理
  const cracks = [];

  // 把折线加宽成ribbon多边形（左右各偏移一半宽度）
  const toRibbon = (points, widths) => {
    const left = [];
    const right = [];

    for (let i = 0; i < points.length; i++) {
      const prev = points[i - 1] || points[i];
      const next = points[i + 1] || points[i];
      let dx = next.x - prev.x;
      let dy = next.y - prev.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const half = Math.max(0.6, widths[i] / 2);

      left.push({ x: points[i].x + nx * half, y: points[i].y + ny * half });
      right.push({ x: points[i].x - nx * half, y: points[i].y - ny * half });
    }

    return [...left, ...right.reverse()];
  };

  const grow = (origin, angle, length, width, depth) => {
    const steps = 4 + Math.floor(Math.random() * 4);
    const points = [origin];
    const stepLen = length / steps;

    // 每条裂缝自己的弯曲倾向 + 局部抖动，避免所有裂缝同一种折线
    const curvature = (Math.random() - 0.5) * 1.4;
    const jitter = 0.2 + Math.random() * 0.5;
    // 收窄指数：小的掉得快，大的能拖很长
    const taper = 0.55 + Math.random() * 1.15;
    // 宽度沿程起伏幅度
    const wobble = 0.12 + Math.random() * 0.38;

    let a = angle;
    let x = origin.x;
    let y = origin.y;

    for (let i = 0; i < steps; i++) {
      a += curvature / steps + (Math.random() - 0.5) * jitter;
      x += Math.cos(a) * stepLen;
      y += Math.sin(a) * stepLen;
      points.push({ x, y });
    }

    // 起点/末端宽度由配置决定，中间的收窄曲线再叠加随机指数与起伏
    const startW = Math.max(0.6, width * crackStartWidth);
    const endW = Math.max(0.4, width * crackEndWidth);

    const widths = points.map((_, i) => {
      const t = i / (points.length - 1);
      const curve = Math.pow(1 - t, taper);
      const noise = 1 + (Math.random() - 0.5) * 2 * wobble;
      return Math.max(0.5, (endW + (startW - endW) * curve) * noise);
    });

    widths[0] = startW * (0.92 + Math.random() * 0.16);
    widths[widths.length - 1] = endW;

    cracks.push(oriented(toRibbon(points, widths)));

    if (depth <= 0) return;

    const branches = Math.random() > 0.5 ? 2 : 1;
    for (let b = 0; b < branches; b++) {
      const idx = 1 + Math.floor(Math.random() * Math.max(1, points.length - 2));
      const p = points[idx];
      const side = Math.random() > 0.5 ? 1 : -1;
      grow(
        p,
        a + side * (0.45 + Math.random() * 0.55),
        length * (0.22 + Math.random() * 0.4),
        widths[idx] * (0.45 + Math.random() * 0.35),
        depth - 1
      );
    }
  };

  // 光滑弹孔不带裂缝
  if (!smooth) {
    const mainCracks = 5;
    for (let i = 0; i < mainCracks; i++) {
      const angle = (i / mainCracks) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
      const startR = r * (0.62 + Math.random() * 0.18);
      const origin = {
        x: lx + Math.cos(angle) * startR,
        y: ly + Math.sin(angle) * startR,
      };

      // 长短、粗细各自独立浮动，避免五条裂缝看起来一个样
      const lengthMul = crackLength * (0.5 + Math.random() * 1.9);
      const widthMul = 0.5 + Math.random() * 1.2;

      grow(origin, angle, r * lengthMul, Math.max(3, r * crackWidth) * widthMul, 1);
    }
  }

  const pathData =
    `M0 0 H${box.width.toFixed(1)} V${box.height.toFixed(1)} H0 Z ` +
    toSubpath(oriented(holePoints)) +
    ' ' +
    cracks.map(toSubpath).join(' ');

  const maskSvg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${box.width}" height="${box.height}">` +
    `<path d="${pathData}" fill="#fff"/></svg>`;

  const maskUrl = `url("data:image/svg+xml,${encodeURIComponent(maskSvg)}")`;
  node.style.webkitMaskImage = maskUrl;
  node.style.maskImage = maskUrl;
  node.style.maskRepeat = 'no-repeat';
  node.style.maskSize = '100% 100%';

  // 3) 洞口四周的碎块：三角形，从弹着点向外飞（光滑弹孔不产生碎块）
  const shardCount = smooth ? 0 : 8;
  for (let i = 0; i < shardCount; i++) {
    const angle = (i / shardCount) * Math.PI * 2 + Math.random() * 0.4;
    const inner = r * (0.85 + Math.random() * 0.2);
    const outer = r * (1.3 + Math.random() * 0.45);
    const spread = 0.16 + Math.random() * 0.14;

    const poly = [
      { x: lx + Math.cos(angle) * inner, y: ly + Math.sin(angle) * inner },
      { x: lx + Math.cos(angle - spread) * outer, y: ly + Math.sin(angle - spread) * outer },
      { x: lx + Math.cos(angle + spread) * outer, y: ly + Math.sin(angle + spread) * outer },
    ];

    const shard = build(poly);
    const power = 200 + Math.random() * 220;
    animate(shard, {
      tx: Math.cos(angle) * power,
      ty: Math.sin(angle) * power + 220,
      rot: (Math.random() - 0.5) * 300,
      axis: Math.random() > 0.5 ? 1 : -1,
      hitStop: hitStop + Math.random() * 50,
    });
  }

  // 命中瞬间亮一下，立刻恢复原色，避免整块常亮
  node.style.transition = 'filter 0.18s ease-out';
  setTimeout(() => {
    node.style.filter = 'none';
  }, 60);

  // 主体再停留一会儿让人看清裂口，然后塌落消失
  const hold = Number.isFinite(holdMs) ? Math.max(0, holdMs) : 620;
  setTimeout(() => {
    node.style.transition = 'transform 0.85s ease-in, opacity 0.85s ease-in';
    node.style.transform = 'translate3d(0, 150px, 0) scale(0.97)';
    node.style.opacity = '0';
    setTimeout(() => {
      if (node.parentNode) node.parentNode.removeChild(node);
    }, 950);
  }, hitStop + hold);

  return true;
}

export function spawnDOMFragments(el, rect, hitPoint, dir, entryPoint, hitStop) {
  if (!entryPoint) return;

  let dx = dir.x;
  let dy = dir.y;
  const len = Math.hypot(dx, dy);
  if (len < 0.001) {
    dx = 1;
    dy = 0;
  } else {
    dx /= len;
    dy /= len;
  }

  const oversized = rect.width > window.innerWidth || rect.height > window.innerHeight;

  let box = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  if (oversized) {
    box = visibleBox(rect);
    if (box.width < 4 || box.height < 4) return;
  }

  let ax = entryPoint.x - box.left;
  let ay = entryPoint.y - box.top;
  if (oversized) {
    ax = Math.min(Math.max(ax, 0), box.width);
    ay = Math.min(Math.max(ay, 0), box.height);
  }
  const a = { x: ax, y: ay };

  const { polyA, polyB } = getSplitPolygons(box.width, box.height, a, dx, dy);
  if (polyA.length < 3 || polyB.length < 3) return;

  const filterStr = 'brightness(2.5) contrast(1.5)';
  const build = makeBuilder(el, rect, box, oversized, filterStr);

  const metaBase = { build, box, screenCache: null, bornAt: performance.now() };

  const pieceA = build(polyA);
  registerPiece(pieceA, { ...metaBase, polygon: polyA });
  const pieceB = build(polyB);
  registerPiece(pieceB, { ...metaBase, polygon: polyB });

  const nx = -dy;
  const speedX = 150 + Math.min(200, len * 3);
  const rotA = (Math.random() - 0.5) * 90;
  const rotB = (Math.random() - 0.5) * 90;

  animate(pieceA, { nx, speedX, rot: rotA, axis: 1, hitStop });
  animate(pieceB, { nx: -nx, speedX, rot: rotB, axis: -1, hitStop });
}

// 多刀炸开：按所有切线顺序切分，松手瞬间一次性散成 N+1 块（次元斩）
export function spawnMultiCutFragments(el, rect, cuts, hitStop) {
  if (!Array.isArray(cuts) || !cuts.length) return false;

  const oversized = rect.width > window.innerWidth || rect.height > window.innerHeight;

  let box = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  if (oversized) {
    box = visibleBox(rect);
    if (box.width < 4 || box.height < 4) return false;
  }

  const base = [
    { x: 0, y: 0 },
    { x: box.width, y: 0 },
    { x: box.width, y: box.height },
    { x: 0, y: box.height },
  ];

  const localCuts = [];
  for (const cut of cuts) {
    let ax = cut.entry.x - box.left;
    let ay = cut.entry.y - box.top;
    if (oversized) {
      ax = Math.min(Math.max(ax, 0), box.width);
      ay = Math.min(Math.max(ay, 0), box.height);
    }

    let dx = cut.hitPoint.x - cut.entry.x;
    let dy = cut.hitPoint.y - cut.entry.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) continue;

    localCuts.push({ a: { x: ax, y: ay }, dx: dx / len, dy: dy / len });
  }
  if (!localCuts.length) return false;

  // 按切割顺序分层：每块记录自己被第几刀切开，用于错峰炸开
  let layers = [{ poly: base, depth: 0 }];
  for (let i = 0; i < localCuts.length; i++) {
    const cut = localCuts[i];
    const next = [];
    for (const item of layers) {
      const { left, right } = splitPolygon(item.poly, cut.a, cut.dx, cut.dy);
      const aOk = left.length >= 3 && polygonArea(left) > 0;
      const bOk = right.length >= 3 && polygonArea(right) > 0;

      if (aOk && bOk) {
        next.push({ poly: left, depth: i + 1 });
        next.push({ poly: right, depth: i + 1 });
      } else if (aOk) {
        next.push({ poly: left, depth: item.depth });
      } else if (bOk) {
        next.push({ poly: right, depth: item.depth });
      } else {
        next.push(item);
      }
    }
    layers = next;
  }

  const pieces = layers.filter((x) => polygonArea(x.poly) >= MIN_PIECE_AREA);
  if (pieces.length < 2) return false;

  const build = makeBuilder(
    el,
    rect,
    box,
    oversized,
    'brightness(2.5) contrast(1.5) drop-shadow(0 0 8px rgba(0, 255, 204, 0.85))'
  );
  const cx = box.width / 2;
  const cy = box.height / 2;

  for (const { poly, depth } of pieces) {
    const node = build(poly);
    registerPiece(node, {
      build,
      box,
      polygon: poly,
      screenCache: null,
      bornAt: performance.now(),
    });

    let vx = polyCenter(poly).x - cx;
    let vy = polyCenter(poly).y - cy;
    const dist = Math.hypot(vx, vy) || 1;
    vx /= dist;
    vy /= dist;

    // 先让切口露出一道细缝，停一拍再飞散（次元斩的“切开→炸开”节奏）
    node.style.transition = 'transform 0.12s ease-out';
    node.style.transform = `translate3d(${vx * 2}px, ${vy * 2}px, 0)`;

    animate(node, {
      nx: vx,
      speedX: 110 + Math.random() * 130,
      rot: (Math.random() - 0.5) * 120,
      axis: Math.random() > 0.5 ? 1 : -1,
      hitStop: hitStop + 150 + depth * 45,
    });
  }

  return true;
}

function polyCenter(poly) {
  let sx = 0;
  let sy = 0;
  for (const p of poly) {
    sx += p.x;
    sy += p.y;
  }
  return { x: sx / poly.length, y: sy / poly.length };
}

// 连切：把一块碎片沿新的刀线再分成两块，子块从父块的当前姿态继续飞
export function reslicePiece(item, entry, exit, hitStop, onSlice) {
  const node = item.node;
  const meta = item.meta;
  if (!node.isConnected) return false;

  const a = screenToLocal(node, meta, entry);
  const b = screenToLocal(node, meta, exit);

  let dx = b.x - a.x;
  let dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 4) return false;
  dx /= len;
  dy /= len;

  const { left, right } = splitPolygon(meta.polygon, a, dx, dy);
  if (left.length < 3 || right.length < 3) return false;
  if (polygonArea(left) < MIN_PIECE_AREA || polygonArea(right) < MIN_PIECE_AREA) return false;

  const cs = window.getComputedStyle(node);
  const fromTransform = cs.transform === 'none' ? '' : cs.transform;
  const fromOpacity = cs.opacity;

  const sliceRect = node.getBoundingClientRect();

  const nodeA = meta.build(left);
  const nodeB = meta.build(right);

  registerPiece(nodeA, {
    ...meta,
    polygon: left,
    screenCache: null,
    bornAt: performance.now(),
  });
  registerPiece(nodeB, {
    ...meta,
    polygon: right,
    screenCache: null,
    bornAt: performance.now(),
  });

  unregisterPiece(node);
  if (node.parentNode) node.parentNode.removeChild(node);

  const nx = -dy;
  const speedX = 150 + Math.min(200, len * 3);

  animate(nodeA, {
    nx,
    speedX,
    rot: (Math.random() - 0.5) * 90,
    axis: 1,
    hitStop: 0,
    fromTransform,
    fromOpacity,
  });
  animate(nodeB, {
    nx: -nx,
    speedX,
    rot: (Math.random() - 0.5) * 90,
    axis: -1,
    hitStop: 0,
    fromTransform,
    fromOpacity,
  });

  if (typeof onSlice === 'function') {
    onSlice({ el: node, rect: sliceRect, piece: true });
  }

  return true;
}
