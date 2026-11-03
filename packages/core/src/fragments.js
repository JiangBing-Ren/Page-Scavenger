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

export function spawnDOMFragments(el, rect, hitPoint, dir, entryPoint, hitStop) {
  const w = rect.width;
  const h = rect.height;

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

  const a = { x: entryPoint.x - rect.left, y: entryPoint.y - rect.top };

  const { polyA, polyB } = getSplitPolygons(w, h, a, dx, dy);
  if (polyA.length < 3 || polyB.length < 3) return;

  const toPolygon = (poly) =>
    poly.map((p) => `${p.x.toFixed(1)}px ${p.y.toFixed(1)}px`).join(',');
  const pStrA = toPolygon(polyA);
  const pStrB = toPolygon(polyB);

  const baseStyle = {
    position: 'fixed',
    left: rect.left + 'px',
    top: rect.top + 'px',
    width: w + 'px',
    height: h + 'px',
    margin: '0',
    boxSizing: 'border-box',
    pointerEvents: 'none',
    zIndex: '2147483645',
    transformOrigin: 'center center',
    overflow: 'hidden',
    willChange: 'transform, opacity',
  };

  const filterStr = 'brightness(2.5) contrast(1.5)';

  const cloneA = cloneForFragment(el);
  cloneA.removeAttribute('id');
  Object.assign(cloneA.style, baseStyle, { clipPath: `polygon(${pStrA})`, filter: filterStr });
  cloneA.style.setProperty('visibility', 'visible', 'important');
  document.body.appendChild(cloneA);

  const cloneB = cloneForFragment(el);
  cloneB.removeAttribute('id');
  Object.assign(cloneB.style, baseStyle, { clipPath: `polygon(${pStrB})`, filter: filterStr });
  cloneB.style.setProperty('visibility', 'visible', 'important');
  document.body.appendChild(cloneB);

  const nx = -dy;
  const ny = dx;
  const speedX = 150 + Math.min(200, len * 3);
  const rotA = (Math.random() - 0.5) * 90;
  const rotB = (Math.random() - 0.5) * 90;

  setTimeout(() => {
    const trans = 'transform 1.2s cubic-bezier(0.3, 0.1, 0.6, 1), opacity 0.6s ease-in 0.6s, filter 0.2s';

    Object.assign(cloneA.style, {
      transition: trans,
      transform: `translate3d(${nx * speedX}px, 600px, 0) rotate3d(1, 1, 0, ${rotA}deg)`,
      opacity: '0',
      filter: 'none',
    });

    Object.assign(cloneB.style, {
      transition: trans,
      transform: `translate3d(${-nx * speedX}px, 600px, 0) rotate3d(1, -1, 0, ${rotB}deg)`,
      opacity: '0',
      filter: 'none',
    });

    setTimeout(() => {
      if (cloneA.parentNode) cloneA.parentNode.removeChild(cloneA);
      if (cloneB.parentNode) cloneB.parentNode.removeChild(cloneB);
    }, 1500);
  }, hitStop);
}
