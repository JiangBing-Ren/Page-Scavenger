import { MEDIA_SELECTOR } from './config.js';
import { getSplitPolygons, polygonArea } from './geometry.js';
import {
  registerPiece,
  unregisterPiece,
  splitPolygon,
  splitPolygonMany,
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
  const { nx, speedX, rot, axis, hitStop, fromTransform, fromOpacity } = options;

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
      transform: `translate3d(${nx * speedX}px, 600px, 0) rotate3d(1, ${axis}, 0, ${rot}deg)`,
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

  const polys = splitPolygonMany(base, localCuts, 0).filter((p) => polygonArea(p) >= MIN_PIECE_AREA);
  if (polys.length < 2) return false;

  const build = makeBuilder(el, rect, box, oversized, 'brightness(2.5) contrast(1.5)');
  const cx = box.width / 2;
  const cy = box.height / 2;

  for (const poly of polys) {
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
      hitStop,
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
