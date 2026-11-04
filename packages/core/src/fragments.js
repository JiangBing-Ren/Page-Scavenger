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
export function spawnBlastHole(el, rect, centerX, centerY, holeRadius, hitStop, holdMs) {
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
  const r = Math.max(8, Number(holeRadius) || 60);

  // 多边形绕向必须与外框相反，nonzero 填充下才能真正挖空
  const oriented = (points) => ensureWinding(points, true);

  const toSubpath = (points) =>
    'M' + points.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L') + ' Z';

  // 1) 不规则洞口：半径带随机抖动，避免看起来像规整的圆
  const segments = 16;
  const holePoints = [];
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    const jitter = 0.68 + Math.random() * 0.62;
    holePoints.push({
      x: lx + Math.cos(angle) * r * jitter,
      y: ly + Math.sin(angle) * r * jitter,
    });
  }

  // 2) 裂缝：真正切开的渐宽缝隙（不是画黑线），从裂口向外收窄
  const cracks = [];
  const crackCount = 7;
  for (let i = 0; i < crackCount; i++) {
    const base = (i / crackCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.55;
    const bend = (Math.random() - 0.5) * 0.5;
    const startR = r * (0.72 + Math.random() * 0.16);
    const total = r * (0.95 + Math.random() * 1.5);

    const start = { x: lx + Math.cos(base) * startR, y: ly + Math.sin(base) * startR };
    const midAngle = base + bend * 0.5;
    const mid = {
      x: lx + Math.cos(midAngle) * (startR + total * 0.5),
      y: ly + Math.sin(midAngle) * (startR + total * 0.5),
    };
    const endAngle = base + bend;
    const end = {
      x: lx + Math.cos(endAngle) * (startR + total),
      y: ly + Math.sin(endAngle) * (startR + total),
    };

    const wide = Math.max(4, r * 0.19);
    const thin = Math.max(1.4, wide * 0.18);

    const n0 = { x: -Math.sin(base), y: Math.cos(base) };
    const n1 = { x: -Math.sin(midAngle), y: Math.cos(midAngle) };
    const n2 = { x: -Math.sin(endAngle), y: Math.cos(endAngle) };

    cracks.push(
      oriented([
        { x: start.x + n0.x * wide * 0.5, y: start.y + n0.y * wide * 0.5 },
        { x: mid.x + n1.x * wide * 0.34, y: mid.y + n1.y * wide * 0.34 },
        { x: end.x + n2.x * thin * 0.5, y: end.y + n2.y * thin * 0.5 },
        { x: end.x - n2.x * thin * 0.5, y: end.y - n2.y * thin * 0.5 },
        { x: mid.x - n1.x * wide * 0.34, y: mid.y - n1.y * wide * 0.34 },
        { x: start.x - n0.x * wide * 0.5, y: start.y - n0.y * wide * 0.5 },
      ])
    );
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

  // 3) 洞口四周的碎块：三角形，从弹着点向外飞
  const shardCount = 8;
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

    animate(node, {
      nx: vx,
      speedX: 110 + Math.random() * 130,
      rot: (Math.random() - 0.5) * 120,
      axis: Math.random() > 0.5 ? 1 : -1,
      hitStop: hitStop + depth * 45,
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
