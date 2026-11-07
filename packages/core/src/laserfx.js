// 激光炮的视觉层：跟随光标的炮台、Warp in 式中空光柱、Burn away 式焦边。
//
// 原作与上游许可（MIT）：
//   pixelfx — Copyright (c) 2026 Patch
//     · src/fx/scifi/warp-in.js 的光柱（管壁分层、中空管、滚动脉冲、下行环、落点光池、引导虚线）
//     · src/fx/transitions/burn-away.js 的灼烧边缘（白热→橙红→焦黑色带、火舌）
//   两者的光柱与火焰分别改编自 Sprite Fusion 的开源 holy-light
//   (https://www.spritefusion.com/pixel-art-vfx/holy-light) 与 fire
//   (https://www.spritefusion.com/pixel-art-vfx/fire)，MIT，Copyright (c) 2026 Hugo Duprez
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
// 移植差异：原效果是逐像素 frame buffer 上的全屏动画，本项目改为 canvas 2D 的
// 对称色带 + 少量合并 path，保留分层/中空/滚动/焦边色阶，不做 ImageData 通道。

const TAU = Math.PI * 2;
const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

// 激光炮自身的武器图标：圆形底座 + 指向光标的炮管 + 蓄力刻度环 + 发射后坐
export function drawLaserEmitter(ctx, sprite, config) {
  if (!sprite || !sprite.active) return;
  const { x, y, aimX, aimY } = sprite;
  const charge = clamp(Number(sprite.charge) || 0, 0, 1);
  const over = clamp(Number(sprite.over) || 0, 0, 1);
  const recoil = clamp(Number(sprite.recoil) || 0, 0, 1);
  const dx = aimX - x;
  const dy = aimY - y;
  const len = Math.hypot(dx, dy) || 1;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.atan2(dy / len, dx / len));
  const kick = recoil * 6;

  // 底座
  ctx.fillStyle = 'rgba(18, 38, 76, 0.86)';
  ctx.strokeStyle = 'rgba(120, 200, 255, 0.9)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(0, 0, 11, 0, TAU);
  ctx.fill();
  ctx.stroke();

  // 炮管与枪口亮点
  ctx.fillStyle = 'rgba(90, 170, 240, 0.9)';
  ctx.fillRect(-4 - kick, -3.5, 22, 7);
  ctx.fillStyle = 'rgba(230, 248, 255, 0.95)';
  ctx.fillRect(14 - kick, -1.5, 7, 3);

  // 蓄力环：随比例点亮的刻度弧
  ctx.strokeStyle = `rgba(150, 230, 255, ${(0.35 + 0.6 * charge).toFixed(3)})`;
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.arc(0, 0, 17, -Math.PI / 2, -Math.PI / 2 + TAU * charge);
  ctx.stroke();

  // 过量蓄力：外圈第二环从冷蓝烧到白热，半径随进度向外扩
  if (over > 0.001) {
    ctx.strokeStyle = `rgba(255, ${Math.round(226 + 20 * over)}, ${Math.round(150 - 90 * over)}, ${(0.55 + 0.4 * over).toFixed(3)})`;
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.arc(0, 0, 20 + 4 * over, -Math.PI / 2, -Math.PI / 2 + TAU * over);
    ctx.stroke();
  }

  // 满蓄力的白热核心；过量时更大更亮
  if (charge > 0.9) {
    ctx.fillStyle = `rgba(255, 255, 255, ${(0.9 + 0.1 * over).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(18 - kick, 0, 3.2 + 2.4 * over, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

// Warp in 的 widthAt：引导细线 → 落地过冲 → 稳定嗡鸣 → 收窄成线
function columnWidth(u, W, t) {
  if (u < 0.16) return W * 0.12;
  if (u < 0.32) return W * (1 + 0.45 * Math.exp(-(u - 0.16) * 22));
  if (u < 0.78) return W * (1 + 0.03 * Math.sin(t * 0.03));
  return Math.max(0.8, W * (1 - (u - 0.78) / 0.22));
}

// 一次性贯穿光柱。局部坐标里沿 +x 延伸，宽度沿 y，便于把竖直光柱的
// 管壁分层照搬到任意发射方向。
export function drawLaserColumn(ctx, column, tNow, config) {
  if (!column) return;
  const style = (config && config.laserStyle) || 'column';
  if (style !== 'column') return;

  const u = clamp((tNow - column.t0) / column.durationMs, 0, 1);
  const W = Math.max(2, Number(column.width) || 18);
  const dx = column.to.x - column.from.x;
  const dy = column.to.y - column.from.y;
  const len = Math.hypot(dx, dy) || 1;
  // W 是光柱总宽；管壁按半宽定位，使最外层管壁 ≈ ±0.46W，
  // 与 burns.js 里 ±0.5W 的烧蚀带严格对齐。
  const w = columnWidth(u, W, tNow) / 2;

  ctx.save();
  ctx.translate(column.from.x, column.from.y);
  ctx.rotate(Math.atan2(dy, dx));
  ctx.lineCap = 'round';

  // 蓄势：向前探的引导虚线 + 端点收缩环
  if (u < 0.16) {
    const k = u / 0.16;
    ctx.setLineDash([6, 8]);
    ctx.strokeStyle = `rgba(150, 225, 255, ${(0.35 + 0.5 * k).toFixed(3)})`;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(len * k, 0);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(200, 240, 255, 0.5)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(len * k, 0, 6 + 14 * (1 - k), 0, TAU);
    ctx.stroke();
    ctx.restore();
    return;
  }

  const fade = u > 0.82 ? clamp(1 - (u - 0.82) / 0.18, 0, 1) : 1;

  // 中空管的管壁：四层由冷蓝到白热，左右壁合并进同一条 path
  const bands = [
    { off: 0.92, wf: 0.55, rgb: '80, 190, 255', a: 0.14 },
    { off: 0.7, wf: 0.42, rgb: '70, 170, 255', a: 0.26 },
    { off: 0.46, wf: 0.3, rgb: '140, 220, 255', a: 0.46 },
    { off: 0.24, wf: 0.18, rgb: '255, 255, 255', a: 0.85 },
  ];
  for (const b of bands) {
    ctx.strokeStyle = `rgba(${b.rgb}, ${(b.a * fade).toFixed(3)})`;
    ctx.lineWidth = Math.max(1, w * b.wf);
    ctx.beginPath();
    ctx.moveTo(0, -b.off * w);
    ctx.lineTo(len, -b.off * w);
    ctx.moveTo(0, b.off * w);
    ctx.lineTo(len, b.off * w);
    ctx.stroke();
  }

  // 管心淡光 + 沿柱滚动的脉冲（虚线偏移代替逐像素 pulse）
  ctx.fillStyle = `rgba(120, 200, 255, ${(0.1 * fade).toFixed(3)})`;
  ctx.fillRect(0, -w * 0.2, len, w * 0.4);
  ctx.setLineDash([Math.max(3, w * 0.5), Math.max(10, w * 3)]);
  ctx.lineDashOffset = -((tNow / 8) % 1000);
  ctx.strokeStyle = `rgba(220, 245, 255, ${(0.55 * fade).toFixed(3)})`;
  ctx.lineWidth = Math.max(1, w * 0.12);
  ctx.beginPath();
  ctx.moveTo(0, -w * 0.55);
  ctx.lineTo(len, -w * 0.55);
  ctx.moveTo(0, w * 0.55);
  ctx.lineTo(len, w * 0.55);
  ctx.stroke();
  ctx.setLineDash([]);

  // 沿柱前行的环与落点光池
  const ringU = (((u - 0.16) % 0.22) + 0.22) % 0.22 / 0.22;
  ctx.strokeStyle = `rgba(200, 240, 255, ${(0.5 * fade).toFixed(3)})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(len * ringU, 0, Math.max(1, w * 0.28), Math.max(2, w * 1.18), 0, 0, TAU);
  ctx.stroke();

  const pool = ctx.createRadialGradient(len, 0, 0, len, 0, Math.max(6, w * 3));
  pool.addColorStop(0, `rgba(160, 230, 255, ${(0.42 * fade).toFixed(3)})`);
  pool.addColorStop(1, 'rgba(80, 160, 240, 0)');
  ctx.fillStyle = pool;
  ctx.beginPath();
  ctx.arc(len, 0, Math.max(6, w * 3), 0, TAU);
  ctx.fill();

  ctx.restore();
}

// Burn away 的 8 档 ember line 压成 6 层 canvas 色带：
// 外圈焦痕/暗红 → 红 → 橙 → 黄 → 白热核心，再叠暖光晕、两层火舌与上飘余烬。
// 每层都把全部焦边合并进一条 path，stroke 次数固定，不随烧痕数量增长。
// 宽度是相对烧蚀带半宽 k 的系数：k=1 时最宽层正好等于半宽，
// 于是外圈焦痕总面积与洞相当，不会出现「焦痕比烧痕大一圈」的失衡。
const BURN_LAYERS = [
  { rgb: '74, 23, 18', a: 0.3, k: 1.0 }, // 焦黑外晕（SCORCH 焦痕）
  { rgb: '138, 31, 23', a: 0.46, k: 0.72 }, // 暗红
  { rgb: '201, 40, 31', a: 0.6, k: 0.5 }, // 红
  { rgb: '242, 86, 29', a: 0.72, k: 0.34 }, // 橙
  { rgb: '255, 194, 61', a: 0.82, k: 0.2 }, // 黄
  { rgb: '255, 243, 166', a: 0.95, k: 0.09 }, // 白热核心
];

// 灼烧痕迹：余温散尽后留下的永久焦黑边，比灼烧时的焦边更宽更暗，不闪烁也不发光
const SCAR_LAYERS = [
  { rgb: '24, 13, 11', a: 0.42, k: 1.35 },
  { rgb: '68, 26, 18', a: 0.3, k: 1.0 },
];

// 焦边单独画到离屏层再一次性贴回：多条烧痕交叉时不会把 6 层色带的 alpha
// 叠加两遍（否则交叉处会过曝成一块白斑，读起来像「反向」）。
let edgeLayer = null;

function getEdgeLayer() {
  if (typeof document === 'undefined') return null;
  try {
    const w = Math.max(1, Math.round(window.innerWidth || 1));
    const h = Math.max(1, Math.round(window.innerHeight || 1));
    const dpr = Math.max(1, Number(window.devicePixelRatio) || 1);
    if (edgeLayer && edgeLayer.w === w && edgeLayer.h === h && edgeLayer.dpr === dpr) return edgeLayer;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const c = canvas.getContext('2d');
    if (!c) return null;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    edgeLayer = { canvas, ctx: c, w, h, dpr };
    return edgeLayer;
  } catch (e) {
    return null;
  }
}

export function drawBurnEdges(ctx, edges, tNow) {
  if (!edges || !edges.length) return;

  const layer = getEdgeLayer();
  if (!layer) {
    paintBurnEdges(ctx, edges, tNow);
    return;
  }

  layer.ctx.clearRect(0, 0, layer.w, layer.h);
  paintBurnEdges(layer.ctx, edges, tNow);
  ctx.drawImage(layer.canvas, 0, 0, layer.w, layer.h);
}

// 同一次发射打中的目标共享同一组半宽/灼烧程度，按它们分组，
// 这样色带宽度跟着烧痕走，stroke 次数也不随目标数增长。
function groupEdges(edges) {
  const groups = new Map();
  for (const e of edges) {
    const half = Math.max(2, Number(e.half) || 9);
    const k = clamp(Number(e.intensity) || 1, 0.3, 2);
    const key = `${half.toFixed(2)}|${k.toFixed(2)}`;
    if (!groups.has(key)) groups.set(key, { half, k, list: [] });
    groups.get(key).list.push(e);
  }
  return groups;
}

// 沿光柱法线把折线整体外推，使色带内缘贴住洞缘、落在洞的外侧
function traceLines(ctx, list, shift) {
  for (const e of list) {
    const ox = (e.nx || 0) * shift;
    const oy = (e.ny || 0) * shift;
    for (const [line, sign] of [[e.left, 1], [e.right, -1]]) {
      if (!line || line.length < 2) continue;
      ctx.moveTo(line[0][0] + ox * sign, line[0][1] + oy * sign);
      for (let i = 1; i < line.length; i++) {
        ctx.lineTo(line[i][0] + ox * sign, line[i][1] + oy * sign);
      }
    }
  }
}

function paintBurnEdges(ctx, edges, tNow) {
  // 因果链：激光穿过留下「激光痕迹」（mask 洞）→ 余温产生「灼烧效果」（glow）
  // → 灼烧散尽留下「灼烧痕迹」（scar，永久焦黑边）
  const glow = edges.filter((e) => e.phase !== 'scar');
  const scar = edges.filter((e) => e.phase === 'scar');
  const heat = glow.length ? glow.reduce((s, e) => s + e.heat, 0) / glow.length : 0;
  const cool = 0.35 + 0.65 * heat; // 火线随时间整体冷却
  const flicker = 0.82 + 0.18 * Math.sin(tNow * 0.02); // 白热层的闪烁

  ctx.save();
  // 只画在目标元素内：烧痕被元素边界裁过，特效也必须跟着裁，
  // 否则外围会多出一圈「没有对应烧痕」的焦色。
  ctx.beginPath();
  let clipped = false;
  for (const e of edges) {
    if (!e.rect) continue;
    clipped = true;
    ctx.rect(e.rect.x, e.rect.y, e.rect.w, e.rect.h);
  }
  if (clipped) ctx.clip();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // 1) 灼烧痕迹铺在最底：暗色、不闪烁，长期留在元素上
  for (const g of groupEdges(scar).values()) {
    for (const layer of SCAR_LAYERS) {
      const width = Math.max(1, g.half * layer.k * g.k);
      ctx.strokeStyle = `rgba(${layer.rgb}, ${layer.a.toFixed(3)})`;
      ctx.lineWidth = width;
      ctx.beginPath();
      traceLines(ctx, g.list, width * 0.5);
      ctx.stroke();
    }
  }

  // 2) 灼烧效果叠在上面：发光色带 + 火舌 + 余烬
  for (const g of groupEdges(glow).values()) {
    for (const layer of BURN_LAYERS) {
      const width = Math.max(1, g.half * layer.k * g.k);
      const a = layer.a * cool * (layer.k < 0.12 ? flicker : 1);
      ctx.strokeStyle = `rgba(${layer.rgb}, ${a.toFixed(3)})`;
      ctx.lineWidth = width;
      ctx.beginPath();
      traceLines(ctx, g.list, width * 0.5);
      ctx.stroke();
    }

    // 分层火舌：外层橙红高、内层白黄矮，长度随灼烧程度放大
    for (const [rgb, ratio, scale] of [
      ['242, 86, 29', 0.22, 1],
      ['255, 226, 107', 0.12, 0.55],
    ]) {
      ctx.strokeStyle = `rgba(${rgb}, ${(0.5 * heat).toFixed(3)})`;
      ctx.lineWidth = Math.max(1, g.half * ratio);
      ctx.beginPath();
      for (const e of g.list) {
        const line = e.left;
        if (!line) continue;
        const nx = e.nx || 0;
        const ny = e.ny || 1;
        for (let i = 2; i < line.length; i += 4) {
          const [x, y] = line[i];
          const h =
            (g.half * 0.4 + 9 * e.heat * g.k * Math.abs(Math.sin(i * 1.7 + tNow * 0.012))) * scale;
          const base = g.half * 0.6;
          ctx.moveTo(x + nx * base, y + ny * base);
          ctx.lineTo(x + nx * (base + h) + (Math.random() - 0.5) * 2 * scale, y + ny * (base + h));
        }
      }
      ctx.stroke();
    }

    // 余烬：沿另一侧焦边向外飘散
    ctx.fillStyle = `rgba(255, 200, 110, ${(0.7 * heat).toFixed(3)})`;
    ctx.beginPath();
    for (const e of g.list) {
      const line = e.right;
      if (!line) continue;
      const nx = -(e.nx || 0);
      const ny = -(e.ny || 1);
      for (let i = 3; i < line.length; i += 7) {
        const [x, y] = line[i];
        const rise = g.half * 0.5 + (1 - e.heat) * 10 * (((i % 3) + 1) / 3);
        const ex = x + nx * rise;
        const ey = y + ny * rise;
        ctx.moveTo(ex + 1.2, ey);
        ctx.arc(ex, ey, 1.2, 0, TAU);
      }
    }
    ctx.fill();
  }

  ctx.restore();
}
