// 玻璃碎裂（Shatter wipe）——移植自 pixelfx 的 fx/transitions/shatter-wipe.js
// https://github.com/patch-gg/pixelfx/blob/main/src/fx/transitions/shatter-wipe.js
//
// 原作与上游许可（MIT）：
//   pixelfx — Copyright (c) 2026 Patch
//   其中的撞击闪光、放射裂纹、玻璃碎片与冷光改编自 Sprite Fusion 的开源 ice shatter
//   (https://www.spritefusion.com/pixel-art-vfx/ice)，MIT，Copyright (c) 2026 Hugo Duprez
//
// MIT License
//
// Copyright (c) 2026 Patch
// Copyright (c) 2026 Hugo Duprez
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
//
// 本项目（页面清道夫）为 GPL-3.0；此处按 MIT 要求保留上述版权与许可声明。
//
// 移植差异：原效果是全屏像素 frame buffer 上的 2.8 秒过场（暗玻璃板落下、弹跳、
// 撞击、裂纹赛跑、楔形碎片翻滚）。本项目改为「局部 DOM 楔形碎片 + canvas 裂纹层」：
// 去掉全屏玻璃板，撞击点取实际弹着点，射线/环数按 DOM 克隆开销降采样（原版约 100 块，
// 这里上限 28 块），时间轴由 shatterDurationMs 整体缩放。

import { visibleBox, makeBuilder } from './fragments.js';

const TAU = Math.PI * 2;
const RAYS = 9;
// 每块碎片都是完整 DOM 克隆，数量直接决定卡顿程度
const MAX_SHARDS = 16;
// 只留一圈中间环：原版 4 圈完整同心环会把画面读成蜘蛛网，长楔形才是玻璃碎裂
const RING_K = [0, 0.52, 1];
// 不给碎片加 drop-shadow：它会把每张网格的边都描亮，且逐帧重算滤镜是主要性能杀手。
// 冷色玻璃感改由 canvas 层的裂纹与闪光承担。
const BASE_FILTER = 'brightness(1.14) contrast(1.06) saturate(0.9)';

// 这两段归一化时刻同时被 canvas 裂纹层使用，改动时请同步 render.js
export const SHATTER_IMPACT = 0.16;
export const SHATTER_BURST = 0.42;

const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

// pixelfx 用可复现的 Rng(seed)；本项目每次开火重新取样即可，接口保持一致便于对照源码
function rng() {
  const range = (a, b) => a + Math.random() * (b - a);
  return {
    range,
    chance: (p) => Math.random() < p,
    sign: () => (Math.random() < 0.5 ? -1 : 1),
  };
}

// 把一条边掰成带弧度的折线：整条裂纹有自己的弯曲倾向，再叠局部抖动。
// 段数随长度增长，避免长裂纹被读成一条直线。
function jag(A, B, R) {
  const dx = B[0] - A[0];
  const dy = B[1] - A[1];
  const L = Math.hypot(dx, dy) || 1;
  const n = Math.min(6, Math.max(2, Math.ceil(L / 24)));
  const bend = R.range(-0.18, 0.18);
  const out = [A];
  for (let k = 1; k <= n; k++) {
    const f = k / (n + 1);
    const off = Math.sin(f * Math.PI) * bend * L + R.range(-1, 1) * Math.min(7, L * 0.04);
    out.push([A[0] + dx * f - (dy / L) * off, A[1] + dy * f + (dx / L) * off]);
  }
  out.push(B);
  return out;
}

// 生成放射射线 × 同心环的楔形网格，以及按距离递进的裂纹时间轴。
// 单独导出，便于在不依赖 DOM 的情况下校验切割结果。
export function buildShatterPattern(W, H, Ix, Iy, R = rng()) {
  const maxR = Math.hypot(W, H) * 0.62;
  const RING = RING_K.map((k) => k * maxR);
  const ang = Array.from({ length: RAYS }, (_, i) => ((i + R.range(-0.18, 0.18)) / RAYS) * TAU);
  const speed = ang.map(() => R.range(0.82, 1.28));

  // V[i][j]：第 i 条射线在第 j 环上的落点，j=0 全部汇聚于撞击点
  const V = ang.map((a) =>
    RING.map((r, j) => {
      if (!j) return [Ix, Iy];
      const rr = r * R.range(0.86, 1.14);
      const aa = a + R.range(-0.06, 0.06);
      return [Ix + Math.cos(aa) * rr, Iy + Math.sin(aa) * rr];
    })
  );

  const rad = V.map((v) => v.slice(0, -1).map((A, j) => jag(A, v[j + 1], R)));
  const ring = V.map((v, i) => v.map((A, j) => (j ? jag(A, V[(i + 1) % RAYS][j], R) : null)));
  // 只保留少量中间环：多数射线从撞击点一路裂到底，得到长楔形而非闭合网格
  const keep = V.map(() =>
    RING.map((_, j) => j === 0 || j === RING.length - 1 || R.chance(0.35))
  );

  // 裂纹赛跑：每条射线的尖端按自己的速度向外推进。
  // 只把完全落在目标矩形内的线段交给 canvas，避免裂纹画到元素外面。
  const cracks = [];
  const inside = (x, y) => x >= 0 && y >= 0 && x <= W && y <= H;
  const reach = (i, x, y) =>
    clamp(SHATTER_IMPACT + (0.23 * (Math.hypot(x - Ix, y - Iy) / maxR)) / speed[i], SHATTER_IMPACT, SHATTER_BURST - 0.02);
  const trace = (pts, when, branch = false) => {
    for (let k = 1; k < pts.length; k++) {
      const a = pts[k - 1];
      const b = pts[k];
      if (!inside(a[0], a[1]) || !inside(b[0], b[1])) continue;
      cracks.push({ ax: a[0], ay: a[1], bx: b[0], by: b[1], t0: when(b[0], b[1]), branch });
    }
  };

  // 主放射裂纹按自身速度向外推进；每条再派生 1~2 条斜向短分叉，
  // 分叉不会闭合成环，所以既有树枝感又不会退回蜘蛛网。
  for (let i = 0; i < RAYS; i++) {
    for (const e of rad[i]) {
      trace(e, (x, y) => reach(i, x, y));
      const branchCount = R.chance(0.72) ? (R.chance(0.35) ? 2 : 1) : 0;
      for (let b = 0; b < branchCount; b++) {
        const idx = 1 + Math.floor(R.range(0, Math.max(1, e.length - 2)));
        const [px, py] = e[idx];
        const [qx, qy] = e[idx + 1] || e[idx];
        const baseAngle = Math.atan2(qy - py, qx - px);
        const a = baseAngle + R.sign() * R.range(0.5, 1.15);
        const len = maxR * R.range(0.1, 0.22);
        const end = [px + Math.cos(a) * len, py + Math.sin(a) * len];
        const branch = jag([px, py], end, R);
        const start = reach(i, px, py) + R.range(0.01, 0.03);
        trace(
          branch,
          (x, y) => clamp(start + (Math.hypot(x - px, y - py) / maxR) * 0.09, 0, SHATTER_BURST - 0.01),
          true
        );
      }
    }
  }
  // 环裂纹只留零星几段，且压到很暗，不再把整圈描出来
  for (let i = 0; i < RAYS; i++) {
    for (let j = 1; j < RING.length - 1; j++) {
      if (!keep[i][j] || !R.chance(0.28)) continue;
      const i2 = (i + 1) % RAYS;
      const e = ring[i][j];
      const start = Math.max(reach(i, ...V[i][j]), reach(i2, ...V[i2][j])) + R.range(0.01, 0.03);
      const [ax, ay] = e[0];
      trace(e, (x, y) =>
        clamp(start + (Math.hypot(x - ax, y - ay) / maxR) * 0.12, 0, SHATTER_BURST - 0.01)
      );
    }
  }
  cracks.sort((a, b) => a.t0 - b.t0);

  // 由相邻两条射线 + 相邻两圈环裂纹围成一块楔形碎片
  const cells = [];
  for (let i = 0; i < RAYS; i++) {
    for (let j = 0, jb; j < RING.length - 1; j = jb + 1) {
      for (jb = j; !keep[i][jb + 1]; jb++);
      const i2 = (i + 1) % RAYS;
      const side = (r) => rad[r].slice(j, jb + 1).flatMap((e, k) => (k ? e.slice(1) : e));
      const pts = [...side(i), ...ring[i][jb + 1].slice(1), ...side(i2).reverse().slice(1)];
      if (j) pts.push(...ring[i][j].slice().reverse().slice(1, -1));
      else pts.pop();
      if (pts.length < 3) continue;

      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const [x, y] of pts) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
      if (x1 < 0 || y1 < 0 || x0 >= W || y0 >= H) continue;

      // 围绕可见部分的中心旋转，飞散时不会绕着画面外的虚拟中心打转
      const cx = (clamp(x0, 0, W) + clamp(x1, 0, W)) / 2;
      const cy = (clamp(y0, 0, H) + clamp(y1, 0, H)) / 2;
      const d = Math.hypot(cx - Ix, cy - Iy);
      cells.push({
        pts,
        cx,
        cy,
        d,
        r: Math.hypot(x1 - x0, y1 - y0) / 2,
        tb: SHATTER_BURST + clamp(d / maxR, 0, 1) * 0.12 + R.range(0, 0.02),
      });
    }
  }

  // DOM 克隆比像素绘制贵得多：优先保留近撞击点的碎片，远处的直接丢弃
  cells.sort((a, b) => a.d - b.d);
  if (cells.length > MAX_SHARDS) cells.length = MAX_SHARDS;
  return { cracks, cells, maxR };
}

// 每块碎片用 Web Animations API 做多关键帧的翻滚下落。
// 关键帧只改 transform / opacity：逐帧改 filter 会强制浏览器重算滤镜，是之前卡顿的主因。
function flyShard(node, cell, Ix, Iy, maxR, H, R, startAt, flyMs) {
  const dx = cell.cx - Ix;
  const dy = cell.cy - Iy;
  const d = Math.hypot(dx, dy) || 1;
  const power = (0.35 + R.range(0, 0.55)) * maxR * (1.15 - Math.min(1, cell.d / (maxR * 0.9)));
  const vx = (dx / d) * power + R.range(-0.06, 0.06) * maxR;
  const vy = (dy / d) * power * 0.6 - R.range(0.08, 0.32) * maxR;
  const va = R.sign() * R.range(0.8, 2.6);
  const vphi = R.sign() * R.range(2.2, 6.5);
  const g = R.range(0.9, 1.5) * H * 2;
  const vz = R.range(0.25, 0.7);

  const frames = [];
  const N = 6;
  for (let k = 0; k <= N; k++) {
    const u = k / N;
    const tt = (u * flyMs) / 1000;
    const x = vx * tt;
    const y = vy * tt + 0.5 * g * tt * tt;
    const rot = va * tt * 57.3;
    const phi = vphi * tt;
    const scale = 1 / (1 + vz * tt * 0.5);
    frames.push({
      offset: u,
      transform:
        `perspective(700px) translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) ` +
        `rotate(${rot.toFixed(1)}deg) rotate3d(0, 1, 0, ${(phi * 57.3).toFixed(1)}deg) ` +
        `scale(${scale.toFixed(3)})`,
      opacity: u < 0.6 ? 1 : Math.max(0, 1 - (u - 0.6) / 0.4),
    });
  }

  setTimeout(() => {
    if (!node.parentNode) return;
    try {
      const anim = node.animate(frames, { duration: flyMs, easing: 'linear', fill: 'forwards' });
      if (typeof anim.onfinish !== 'undefined') anim.onfinish = () => node.remove();
      else setTimeout(() => node.remove(), flyMs + 40);
    } catch (_) {
      // 缺少 Web Animations API 时不能把克隆节点留在页面上
      node.remove();
    }
  }, startAt);
}

/**
 * 炮的「玻璃碎裂」破碎形态。真实元素由调用方隐藏；这里只负责碎块出场与 canvas 裂纹数据。
 * 返回 pattern 供 render.js 的 drawShatterWipes 使用，失败时返回 null（调用方回退到经典破碎）。
 */
export function spawnShatterWipe(el, rect, centerX, centerY, options) {
  const opts = options || {};
  const durationMs = clamp(Number(opts.durationMs) || 1400, 400, 4000);
  const oversized = rect.width > window.innerWidth || rect.height > window.innerHeight;

  let box = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  if (oversized) box = visibleBox(rect);
  if (box.width < 4 || box.height < 4) return null;

  const Ix = clamp(centerX - box.left, 0, box.width);
  const Iy = clamp(centerY - box.top, 0, box.height);
  const R = rng();
  const pat = buildShatterPattern(box.width, box.height, Ix, Iy, R);
  if (!pat.cells.length) return null;

  const build = makeBuilder(el, rect, box, oversized, BASE_FILTER);

  // 炮的既有语义：弹着点必须有一个锯齿弹孔。evenodd 让孔从整块元素里挖掉，
  // 与每块碎片的 clip-path 叠加后仍读作同一个洞（与 spawnBlastBreakup 一致）。
  const holeRadius = Math.max(8, Number(opts.holeRadius) || 60);
  const holePoly = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * TAU;
    const jitter = 0.68 + Math.random() * 0.62;
    holePoly.push([Ix + Math.cos(a) * holeRadius * jitter, Iy + Math.sin(a) * holeRadius * jitter]);
  }
  const holePath = holePoly.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L');
  const maskSvg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${box.width}" height="${box.height}">` +
    `<path d="M0 0 H${box.width.toFixed(1)} V${box.height.toFixed(1)} H0 Z ` +
    `M${holePath} Z" fill="#fff" fill-rule="evenodd"/></svg>`;
  const maskUrl = `url("data:image/svg+xml,${encodeURIComponent(maskSvg)}")`;

  for (const cell of pat.cells) {
    const node = build(cell.pts.map(([x, y]) => ({ x, y })));
    node.style.maskImage = maskUrl;
    node.style.webkitMaskImage = maskUrl;
    node.style.maskSize = '100% 100%';
    node.style.maskRepeat = 'no-repeat';
    const startAt = Math.min(durationMs - 80, cell.tb * durationMs);
    const flyMs = Math.max(120, durationMs - startAt);
    flyShard(node, cell, Ix, Iy, pat.maxR, box.height, R, startAt, flyMs);
  }

  // canvas 是全屏坐标系，裂纹点要从元素局部坐标平移过去
  return {
    x: box.left + Ix,
    y: box.top + Iy,
    cracks: pat.cracks.map((c) => ({
      ax: c.ax + box.left,
      ay: c.ay + box.top,
      bx: c.bx + box.left,
      by: c.by + box.top,
      t0: c.t0,
    })),
    durationMs,
    impact: SHATTER_IMPACT,
    burst: SHATTER_BURST,
    // canvas 层用它把裂纹与碎屑裁在「目标矩形 − 弹孔」内：
    // 既不溢出到相邻元素，也不会在挖空的洞里画出裂隙
    left: box.left,
    top: box.top,
    width: box.width,
    height: box.height,
    hole: holePoly.map(([x, y]) => [x + box.left, y + box.top]),
  };
}
