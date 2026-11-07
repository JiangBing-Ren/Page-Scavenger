// 白热刃口（Slash wipe）——移植自 pixelfx 的 fx/transitions/slash-wipe.js
// https://github.com/patch-gg/pixelfx/blob/main/src/fx/transitions/slash-wipe.js
//
// 原作与上游许可（MIT）：
//   pixelfx — Copyright (c) 2026 Patch
//   其中的锥形冷却拖尾、点状残迹、刀尖星芒、刃口火花与飞屑改编自 Sprite Fusion 的开源 slash
//   (https://www.spritefusion.com/pixel-art-vfx/slash)，MIT，Copyright (c) 2026 Hugo Duprez
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
// 移植差异：原效果是全屏 1.7 秒过场（白热刀刃斜扫 → 第二道斜切 → 封面两半滑开飞散）。
// 本项目只移植到「一次挥砍命中的单个元素」：不做全屏封面、不做第二道反向斜切、
// 不引入 ImageData 通道；刀线取玩家真实的划动方向，时间轴由 bladeFxDurationMs 整体缩放。

import { getSplitPolygons } from './geometry.js';
import { visibleBox, makeBuilder } from './fragments.js';

// 归一化时间轴（同时被 render.js 的 drawSlashWipes 使用）
export const SLASH_EDGE_END = 0.46; // 刃口扫完
export const SLASH_SLIP = 0.52; // 两半开始沿切线错开
export const SLASH_SPLIT = 0.66; // 沿法线分离并旋转

const clamp = (v, min, max) => Math.min(Math.max(v, min), max);
const easeOut = (x) => 1 - Math.pow(1 - x, 3);

// 从 (x,y) 沿方向 (dx,dy) 走到矩形边界所需的参数 t
function reachBox(x, y, dx, dy, W, H) {
  let t = Infinity;
  if (dx > 1e-6) t = Math.min(t, (W - x) / dx);
  else if (dx < -1e-6) t = Math.min(t, -x / dx);
  if (dy > 1e-6) t = Math.min(t, (H - y) / dy);
  else if (dy < -1e-6) t = Math.min(t, -y / dy);
  return Number.isFinite(t) ? Math.max(0, t) : 0;
}

/**
 * 刀线与两半的运动参数。单独导出，便于无 DOM 环境下校验几何。
 * 返回 A/B 为元素局部坐标，法线 n 指向 polyA 一侧。
 */
export function buildSlashPattern(W, H, entry, dir) {
  let dx = Number(dir && dir.x) || 0;
  let dy = Number(dir && dir.y) || 0;
  const len = Math.hypot(dx, dy) || 1;
  dx /= len;
  dy /= len;

  const ex = clamp(Number(entry && entry.x) || 0, 0, W);
  const ey = clamp(Number(entry && entry.y) || 0, 0, H);
  const back = reachBox(ex, ey, -dx, -dy, W, H);
  const front = reachBox(ex, ey, dx, dy, W, H);
  const A = [ex - dx * back, ey - dy * back];
  const B = [ex + dx * front, ey + dy * front];
  return { A, B, ux: dx, uy: dy, nx: -dy, ny: dx, length: Math.hypot(B[0] - A[0], B[1] - A[1]) };
}

// 两半沿切线先错开、再沿法线分离并轻微旋转飞散。
// 关键帧只改 transform / opacity：逐帧改 filter 会强制重算滤镜（见 shatter.js 的教训）。
function flyHalf(node, s, pat, span, durationMs, hitStop) {
  const frames = [];
  const N = 8;
  for (let k = 0; k <= N; k++) {
    const u = k / N;
    const slip = 7 * easeOut(clamp((u - SLASH_SLIP) / (SLASH_SPLIT - SLASH_SLIP), 0, 1)) * (s > 0 ? 1 : -0.4);
    const su = Math.max(0, u - SLASH_SPLIT);
    const sep = (0.02 + 0.25 * su + 0.7 * su * su) * span;
    const rot = s * (4 + 26 * su) * su;
    const tx = pat.ux * slip + s * pat.nx * sep;
    const ty = pat.uy * slip + s * pat.ny * sep + 0.22 * span * su * su;
    const scale = 1 - 0.08 * su;
    frames.push({
      offset: u,
      transform:
        `translate3d(${tx.toFixed(1)}px, ${ty.toFixed(1)}px, 0) ` +
        `rotate(${rot.toFixed(1)}deg) scale(${scale.toFixed(3)})`,
      opacity: u < 0.72 ? 1 : Math.max(0, 1 - (u - 0.72) / 0.28),
    });
  }

  const run = () => {
    if (!node.parentNode) return;
    try {
      const anim = node.animate(frames, { duration: durationMs, delay: hitStop, easing: 'linear', fill: 'forwards' });
      if (typeof anim.onfinish !== 'undefined') anim.onfinish = () => node.remove();
      else setTimeout(() => node.remove(), durationMs + hitStop + 40);
    } catch (_) {
      node.remove();
    }
  };
  run();
}

/**
 * 刀的「白热刃口」斩击形态。真实元素由调用方隐藏；这里只负责两半碎块出场与 canvas 刀线数据。
 * 返回 pattern 供 render.js 的 drawSlashWipes 使用，失败时返回 null（调用方回退到经典刀光）。
 */
export function spawnSlashWipeFragments(el, rect, entryPoint, dir, options) {
  if (!entryPoint) return null;
  const opts = options || {};
  const durationMs = clamp(Number(opts.durationMs) || 420, 150, 2000);
  const hitStop = Number.isFinite(opts.hitStop) ? Math.max(0, opts.hitStop) : 0;
  const oversized = rect.width > window.innerWidth || rect.height > window.innerHeight;

  let box = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  if (oversized) box = visibleBox(rect);
  if (box.width < 4 || box.height < 4) return null;

  let dx = Number(dir && dir.x) || 0;
  let dy = Number(dir && dir.y) || 0;
  const dirLen = Math.hypot(dx, dy);
  if (dirLen < 0.001) {
    dx = 1;
    dy = 0;
  } else {
    dx /= dirLen;
    dy /= dirLen;
  }

  // 切分与 canvas 刀线必须用同一个 entry / dir，否则切口与亮带会错开
  const entry = {
    x: clamp(entryPoint.x - box.left, 0, box.width),
    y: clamp(entryPoint.y - box.top, 0, box.height),
  };
  const { polyA, polyB } = getSplitPolygons(box.width, box.height, entry, dx, dy);
  if (polyA.length < 3 || polyB.length < 3) return null;

  const pat = buildSlashPattern(box.width, box.height, entry, { x: dx, y: dy });
  const build = makeBuilder(el, rect, box, oversized, 'brightness(1.25) contrast(1.08)');
  const span = Math.min(box.width, box.height);

  const nodeA = build(polyA);
  const nodeB = build(polyB);
  flyHalf(nodeA, 1, pat, span, durationMs, hitStop);
  flyHalf(nodeB, -1, pat, span, durationMs, hitStop);

  // canvas 是全屏坐标系
  return {
    a: [box.left + pat.A[0], box.top + pat.A[1]],
    b: [box.left + pat.B[0], box.top + pat.B[1]],
    ux: pat.ux,
    uy: pat.uy,
    nx: pat.nx,
    ny: pat.ny,
    length: pat.length,
    durationMs,
    hitStop,
    edgeEnd: SLASH_EDGE_END,
    slip: SLASH_SLIP,
    split: SLASH_SPLIT,
    left: box.left,
    top: box.top,
    width: box.width,
    height: box.height,
  };
}
