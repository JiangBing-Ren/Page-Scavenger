// 局部烧蚀损伤模型：目标不再被一次命中就整体隐藏，而是沿光柱被烧掉一条带，
// 元素保留在 DOM 中且布局不变；多次命中累积烧痕，达到阈值才交给引擎整体结算。
//
// mask 用 canvas 位图而不是 SVG path：SVG 的 nonzero / evenodd 在「两个洞重叠」时
// 绕数会从 0 变成 -1（或从偶变奇），重叠区会重新变实心——正是「交叉处显出目标原样」。
// canvas 的 destination-out 天然做并集，重叠区被擦两次仍然是透明。
//
// 锯齿焦边的多频噪声思路参考 pixelfx 的 Burn away（MIT, Copyright (c) 2026 Patch）
// 与其上游 Sprite Fusion fire（MIT, Copyright (c) 2026 Hugo Duprez）；此文件未复制其代码，
// 完整许可全文见 laserfx.js 头部与手册第 12 节。

const MASK_MAX = 640; // mask 位图最长边，超出按比例缩小（焦边细节由 canvas 层承担）

const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

// 每条烧蚀带独有的多频扰动：低频撑出大起伏，高频咬出细小参差
function edgeNoise(u, seed) {
  return (
    Math.sin(u * 13.1 + seed) * 0.5 +
    Math.sin(u * 31.7 + seed * 1.7) * 0.28 +
    Math.sin(u * 67.3 + seed * 2.3) * 0.15 +
    (Math.random() - 0.5) * 0.12
  );
}

function signedArea(poly) {
  let s = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    s += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
  }
  return s / 2;
}

// Sutherland–Hodgman：把光柱带裁到元素矩形。
// 擦过元素边角时也能得到正确的窄多边形，不会退化成一条线或一个点。
function clipPolyToRect(poly, x0, y0, x1, y1) {
  const edges = [
    { inside: (p) => p[0] >= x0, at: (a, b) => [x0, a[1] + (b[1] - a[1]) * ((x0 - a[0]) / (b[0] - a[0]))] },
    { inside: (p) => p[0] <= x1, at: (a, b) => [x1, a[1] + (b[1] - a[1]) * ((x1 - a[0]) / (b[0] - a[0]))] },
    { inside: (p) => p[1] >= y0, at: (a, b) => [a[0] + (b[0] - a[0]) * ((y0 - a[1]) / (b[1] - a[1])), y0] },
    { inside: (p) => p[1] <= y1, at: (a, b) => [a[0] + (b[0] - a[0]) * ((y1 - a[1]) / (b[1] - a[1])), y1] },
  ];
  let pts = poly;
  for (const e of edges) {
    if (!pts.length) break;
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const ia = e.inside(a);
      const ib = e.inside(b);
      if (ia) out.push(a);
      if (ia !== ib) out.push(e.at(a, b));
    }
    pts = out;
  }
  return pts;
}

/**
 * 生成与光柱等宽的烧蚀带（元素局部坐标）。
 * a/b 为光柱中心线与元素矩形的交点，half 为光柱半宽，bounds 为元素尺寸。
 * poly 用于 mask 挖洞；left/right 是留给 canvas 焦边的两条边，
 * nx/ny 是光柱法线方向，焦边据此向洞的外侧偏移。
 */
export function buildBurnBand(a, b, half, seed, bounds, intensity) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  if (len < 4) return null;
  const k = clamp(Number(intensity) || 1, 0.3, 2);
  const nx = -dy / len;
  const ny = dx / len;
  const steps = Math.max(8, Math.min(56, Math.ceil(len / 10)));
  const left = [];
  const right = [];

  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const x = a.x + dx * u;
    const y = a.y + dy * u;
    // 两侧各自起伏：低频撑出大块熔蚀，高频咬出细小缺口。
    // 基准幅度 ±12%，再乘灼烧程度——烧得越狠，贯穿口边缘越破碎。
    const amp = 0.09 * k;
    const wl = half * (1 + edgeNoise(u, seed) * amp + Math.sin(u * Math.PI * 6 + seed) * 0.03 * k);
    const wr = half * (1 + edgeNoise(u, seed + 17) * amp + Math.sin(u * Math.PI * 5.5 + seed * 1.7) * 0.03 * k);
    left.push([x + nx * wl, y + ny * wl]);
    right.push([x - nx * wr, y - ny * wr]);
  }

  // mask 洞的边就是这两条起伏线，端部由元素矩形裁直 —— 于是「被灼穿」的边缘
  // 有不规则侵蚀感，宽度又始终跟着光柱走
  const raw = [...left, ...right.slice().reverse()];
  const poly = bounds ? clipPolyToRect(raw, 0, 0, bounds.w, bounds.h) : raw;
  if (poly.length < 3) return null;
  const area = Math.abs(signedArea(poly));
  if (area < 24) return null; // 擦边退化成点时不产生烧痕

  return { poly, left, right, area, seed, nx, ny, half, intensity: k };
}

// SVG 回退（无 document 时，例如单元测试）：nonzero + 全部洞统一反向绕向
function asHole(poly) {
  return signedArea(poly) > 0 ? poly.slice().reverse() : poly;
}

function svgMaskUrl(w, h, holes) {
  const d =
    `M0 0 H${w.toFixed(1)} V${h.toFixed(1)} H0 Z ` +
    holes
      .map((p) => 'M' + p.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L') + ' Z')
      .join(' ');
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w.toFixed(1)}" height="${h.toFixed(1)}">` +
    `<path d="${d}" fill="#fff"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

// Element -> { w, h, holes, bands, burned, prevMask, prevWebkit, canvas, ctx, pw, ph, scale }
const records = new Map();

// 用 canvas 重画「白底 + 挖掉所有洞」的 mask 位图。每次烧蚀整体重画：
// 洞的数量有限（一次发射最多十来个），远比维护增量并集简单可靠。
function bitmapMaskUrl(rec, w, h) {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
  try {
    const scale = Math.min(1, MASK_MAX / Math.max(w, h));
    const pw = Math.max(1, Math.round(w * scale));
    const ph = Math.max(1, Math.round(h * scale));
    if (!rec.canvas || rec.pw !== pw || rec.ph !== ph) {
      const canvas = document.createElement('canvas');
      canvas.width = pw;
      canvas.height = ph;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      rec.canvas = canvas;
      rec.ctx = ctx;
      rec.pw = pw;
      rec.ph = ph;
      rec.scale = scale;
    }

    const ctx = rec.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, pw, ph);

    // destination-out 让多条烧蚀带自然并集：重叠区被擦两次仍然是透明
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = '#000';
    for (const hole of rec.holes) {
      ctx.beginPath();
      for (let i = 0; i < hole.length; i++) {
        const x = hole[i][0] * scale;
        const y = hole[i][1] * scale;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';

    return `url("${rec.canvas.toDataURL('image/png')}")`;
  } catch (e) {
    return null;
  }
}

/**
 * 给真实元素追加一条烧蚀带并重建 mask。
 * 返回 { added, ratio, complete, band }；complete 表示烧蚀面积已达阈值。
 */
export function applyBurn(el, band, options) {
  const opts = options || {};
  const threshold = clamp(Number(opts.threshold) || 0.6, 0.05, 1);
  const rect = el.getBoundingClientRect();
  const w = Math.max(1, rect.width);
  const h = Math.max(1, rect.height);

  let rec = records.get(el);
  if (!rec) {
    rec = {
      w,
      h,
      holes: [],
      bands: [],
      burned: 0,
      prevMask: el.style.maskImage || '',
      prevWebkit: el.style.webkitMaskImage || '',
    };
    records.set(el, rec);
  }

  // 元素尺寸变化时按比例缩放已有洞，避免 mask 与内容错位
  if (Math.abs(rec.w - w) > 1 || Math.abs(rec.h - h) > 1) {
    const sx = w / rec.w;
    const sy = h / rec.h;
    rec.holes = rec.holes.map((p) => p.map(([x, y]) => [x * sx, y * sy]));
    rec.bands = rec.bands.map((b) => ({
      ...b,
      left: b.left.map(([x, y]) => [x * sx, y * sy]),
      right: b.right.map(([x, y]) => [x * sx, y * sy]),
    }));
    rec.w = w;
    rec.h = h;
  }

  rec.holes.push(band.poly);
  rec.bands.push({
    left: band.left,
    right: band.right,
    nx: band.nx,
    ny: band.ny,
    half: band.half,
    intensity: band.intensity || 1,
    at: performance.now(),
  });
  const added = Math.min(w * h, band.area);
  rec.burned = Math.min(w * h, rec.burned + added);

  const url = bitmapMaskUrl(rec, w, h) || svgMaskUrl(w, h, rec.holes.map(asHole));
  el.style.maskImage = url;
  el.style.webkitMaskImage = url;
  el.style.maskSize = '100% 100%';
  el.style.maskRepeat = 'no-repeat';
  el.style.webkitMaskSize = '100% 100%';
  el.style.webkitMaskRepeat = 'no-repeat';

  const ratio = rec.burned / (w * h);
  return { added, ratio, complete: ratio >= threshold, band };
}

/**
 * 取出所有烧痕边缘，按因果链分两个阶段：
 *   glow —— 延迟期结束后的余温灼烧，heat 沿正弦先升后降；
 *   scar —— 灼烧衰减完留下的永久焦痕，heat 恒为 0，靠暗色色带表达。
 * delayMs 之前什么都不返回：激光痕迹先出现，余温灼烧要等激光结束才衔接。
 */
export function activeBurnEdges(maxAgeMs, delayMs) {
  const t = performance.now();
  const delay = Math.max(0, Number(delayMs) || 0);
  const life = Math.max(1, Number(maxAgeMs) - delay);
  const out = [];

  for (const [el, rec] of records) {
    if (!el.isConnected) continue;
    const r = el.getBoundingClientRect();
    for (const b of rec.bands) {
      const age = t - b.at - delay;
      if (age < 0) continue; // 激光刚穿过、余温还没上来
      const k = age / life;
      const phase = k > 1 ? 'scar' : 'glow';
      out.push({
        phase,
        heat: phase === 'glow' ? Math.sin(Math.PI * k) : 0,
        left: b.left.map(([x, y]) => [x + r.left, y + r.top]),
        right: b.right.map(([x, y]) => [x + r.left, y + r.top]),
        nx: b.nx,
        ny: b.ny,
        // 焦边宽度跟着烧蚀带半宽与灼烧程度走，才不会被固定像素撑得比洞还大
        half: b.half,
        intensity: b.intensity,
        rect: { x: r.left, y: r.top, w: r.width, h: r.height },
      });
    }
  }
  return out;
}

// 恢复单个元素原状（撤销、整体结算前调用）
export function restoreBurn(el) {
  const rec = records.get(el);
  if (!rec) return false;
  el.style.maskImage = rec.prevMask;
  el.style.webkitMaskImage = rec.prevWebkit;
  records.delete(el);
  return true;
}

// 退出斩击 / 切武器时清空所有损伤，避免把 mask 永久留在页面上
export function clearBurns() {
  for (const el of records.keys()) restoreBurn(el);
  records.clear();
}

export function burnCount() {
  return records.size;
}
