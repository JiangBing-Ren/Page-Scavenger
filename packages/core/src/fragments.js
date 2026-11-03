import { MEDIA_SELECTOR } from './config.js';
import { getSplitPolygons } from './geometry.js';

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

function animatePieces(pieceA, pieceB, nx, speedX, rotA, rotB, hitStop) {
  setTimeout(() => {
    const trans =
      'transform 1.2s cubic-bezier(0.3, 0.1, 0.6, 1), opacity 0.6s ease-in 0.6s, filter 0.2s';

    Object.assign(pieceA.style, {
      transition: trans,
      transform: `translate3d(${nx * speedX}px, 600px, 0) rotate3d(1, 1, 0, ${rotA}deg)`,
      opacity: '0',
      filter: 'none',
    });

    Object.assign(pieceB.style, {
      transition: trans,
      transform: `translate3d(${-nx * speedX}px, 600px, 0) rotate3d(1, -1, 0, ${rotB}deg)`,
      opacity: '0',
      filter: 'none',
    });

    setTimeout(() => {
      if (pieceA.parentNode) pieceA.parentNode.removeChild(pieceA);
      if (pieceB.parentNode) pieceB.parentNode.removeChild(pieceB);
    }, 1500);
  }, hitStop);
}

// 超大元素：只切可见的那一块。外面套一层按可见区域裁剪的容器，
// 内层克隆保持元素真实尺寸并做负向偏移。
function buildOversizePiece(el, rect, box, polygonStr, filterStr) {
  const wrapper = document.createElement('div');
  wrapper.setAttribute('data-adslash-ui', '1');
  Object.assign(wrapper.style, baseStyleFor(box.left, box.top, box.width, box.height), {
    clipPath: `polygon(${polygonStr})`,
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

  const w = box.width;
  const h = box.height;

  const { polyA, polyB } = getSplitPolygons(w, h, a, dx, dy);
  if (polyA.length < 3 || polyB.length < 3) return;

  const toPolygon = (poly) => poly.map((p) => `${p.x.toFixed(1)}px ${p.y.toFixed(1)}px`).join(',');
  const pStrA = toPolygon(polyA);
  const pStrB = toPolygon(polyB);

  const filterStr = 'brightness(2.5) contrast(1.5)';

  let pieceA;
  let pieceB;

  if (oversized) {
    pieceA = buildOversizePiece(el, rect, box, pStrA, filterStr);
    pieceB = buildOversizePiece(el, rect, box, pStrB, filterStr);
  } else {
    pieceA = cloneForFragment(el);
    pieceA.removeAttribute('id');
    pieceA.setAttribute('data-adslash-ui', '1');
    Object.assign(pieceA.style, baseStyleFor(box.left, box.top, w, h), {
      clipPath: `polygon(${pStrA})`,
      filter: filterStr,
    });
    pieceA.style.setProperty('visibility', 'visible', 'important');
    document.body.appendChild(pieceA);

    pieceB = cloneForFragment(el);
    pieceB.removeAttribute('id');
    pieceB.setAttribute('data-adslash-ui', '1');
    Object.assign(pieceB.style, baseStyleFor(box.left, box.top, w, h), {
      clipPath: `polygon(${pStrB})`,
      filter: filterStr,
    });
    pieceB.style.setProperty('visibility', 'visible', 'important');
    document.body.appendChild(pieceB);
  }

  const nx = -dy;
  const ny = dx;
  const speedX = 150 + Math.min(200, len * 3);
  const rotA = (Math.random() - 0.5) * 90;
  const rotB = (Math.random() - 0.5) * 90;

  animatePieces(pieceA, pieceB, nx, speedX, rotA, rotB, hitStop);
}
