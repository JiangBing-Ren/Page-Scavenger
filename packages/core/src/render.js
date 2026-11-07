const now = () => performance.now();

const easeOutCubic = (x) => 1 - Math.pow(1 - x, 3);

// Slash wipe 风格的刀光：冷蓝冷却带 + 点状残迹 + 白热核心 + 刀尖亮点。
// 签名与 renderMultiLayerTrail 一致，便于按 bladeStyle 直接替换。
export function renderSlashWipeTrail(ctx, points, maxWidth, alpha) {
  if (!points || points.length < 2 || alpha <= 0) return;
  const len = points.length;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // 冷却带：越靠刀尖越宽的冷蓝锥形拖尾
  const left = [];
  const right = [];
  for (let i = 0; i < len; i++) {
    const p = points[i];
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(len - 1, i + 1)];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const d = Math.hypot(dx, dy) || 1;
    const nx = -dy / d;
    const ny = dx / d;
    const w = maxWidth * Math.pow(i / (len - 1), 1.3) * alpha;
    left.push({ x: p.x + nx * w, y: p.y + ny * w });
    right.push({ x: p.x - nx * w, y: p.y - ny * w });
  }
  const poly = [...left, ...right.reverse()];
  ctx.fillStyle = `rgba(98, 200, 244, ${(alpha * 0.28).toFixed(3)})`;
  ctx.beginPath();
  ctx.moveTo(poly[0].x, poly[0].y);
  for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
  ctx.closePath();
  ctx.fill();

  // 点状残迹：轨迹后方留下的冷蓝小点
  ctx.fillStyle = `rgba(184, 201, 232, ${(alpha * 0.55).toFixed(3)})`;
  ctx.beginPath();
  for (let i = 0; i < len; i += 3) {
    const p = points[i];
    ctx.moveTo(p.x + 1.2, p.y);
    ctx.arc(p.x, p.y, 1.2, 0, Math.PI * 2);
  }
  ctx.fill();

  // 白热核心与刀尖
  ctx.strokeStyle = `rgba(255, 255, 255, ${(alpha * 0.95).toFixed(3)})`;
  ctx.lineWidth = Math.max(1.2, maxWidth * 0.1);
  ctx.beginPath();
  for (let i = 0; i < len; i++) {
    if (i === 0) ctx.moveTo(points[i].x, points[i].y);
    else ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.stroke();

  const tip = points[len - 1];
  ctx.fillStyle = `rgba(255, 255, 255, ${alpha.toFixed(3)})`;
  ctx.beginPath();
  ctx.arc(tip.x, tip.y, 2.4 * alpha, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// Slash wipe 命中特效：刃口白热扫过、暖色火花喷泉、切口白热→冷蓝亮带。
// 数据由 slashwipe.js 生成，时间轴为归一化 u∈[0,1]；全部裁剪在目标矩形内。
export function drawSlashWipes(ctx, state) {
  const list = state.slashWipes;
  if (!list || !list.length) return;

  for (let i = list.length - 1; i >= 0; i--) {
    const fx = list[i];
    const u = (now() - fx.t0) / fx.durationMs;
    if (u < 0) continue;
    if (u >= 1) {
      list.splice(i, 1);
      continue;
    }

    const [ax, ay] = fx.a;
    const [bx, by] = fx.b;
    const headAt = (k) => [ax + (bx - ax) * k, ay + (by - ay) * k];
    const hasBox = [fx.left, fx.top, fx.width, fx.height].every(Number.isFinite);
    // 确定性伪随机：同一刀线的火花不会逐帧跳动
    const rand = (n) => {
      const v = Math.sin(n * 12.9898 + fx.length * 0.017) * 43758.5453;
      return v - Math.floor(v);
    };

    ctx.save();
    ctx.lineCap = 'round';
    if (hasBox) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(fx.left, fx.top, fx.width, fx.height);
      ctx.clip();
    }

    // 1) 白热刃口：冷却带 + 白核心 + 身后的点状残迹
    if (u < fx.edgeEnd + 0.22) {
      const k = easeOutCubic(Math.min(1, u / fx.edgeEnd));
      const [hx, hy] = headAt(k);
      const [tx, ty] = headAt(Math.max(0, k - 0.35));

      ctx.strokeStyle = `rgba(58, 139, 216, ${(0.55 * (1 - u)).toFixed(3)})`;
      ctx.lineWidth = 9 * (1 - u * 0.5);
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(hx, hy);
      ctx.stroke();

      ctx.strokeStyle = `rgba(255, 255, 255, ${(0.95 * (1 - u * 0.6)).toFixed(3)})`;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(hx, hy);
      ctx.stroke();

      ctx.fillStyle = `rgba(184, 201, 232, ${(0.6 * (1 - u)).toFixed(3)})`;
      ctx.beginPath();
      for (let d = 0.05; d < k; d += 0.07) {
        const [px, py] = headAt(d);
        ctx.moveTo(px + 1.3, py);
        ctx.arc(px, py, 1.3, 0, Math.PI * 2);
      }
      ctx.fill();
    }

    // 2) 暖色火花喷泉：沿刃口走过的部分向后喷，按颜色合并成两组批量描边
    if (u < fx.slip + 0.15) {
      const fly = Math.min(1, u / (fx.slip + 0.15));
      const groups = [
        { rgb: '255, 226, 107', a: 0.9, segs: [] },
        { rgb: '242, 86, 29', a: 0.7, segs: [] },
      ];
      const reach = Math.min(1, u / fx.edgeEnd);
      for (let s = 0; s < 14; s++) {
        const [px, py] = headAt(rand(s) * reach);
        const ang = Math.atan2(-fx.uy, -fx.ux) + (rand(s + 40) - 0.5) * 1.6;
        const dist = 6 + fly * (18 + rand(s + 80) * 26);
        groups[s % 2].segs.push([
          px, py,
          px + Math.cos(ang) * dist,
          py + Math.sin(ang) * dist + fly * fly * 14,
        ]);
      }
      for (const g of groups) {
        if (!g.segs.length) continue;
        ctx.strokeStyle = `rgba(${g.rgb}, ${(g.a * (1 - fly)).toFixed(3)})`;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        for (const [x0, y0, x1, y1] of g.segs) {
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
        }
        ctx.stroke();
      }
    }

    // 3) 切口亮带：两半沿法线分开时，边缘从白热冷却到冷蓝
    if (u >= fx.slip) {
      const su = Math.max(0, u - fx.split);
      const sep = (0.02 + 0.25 * su + 0.7 * su * su) * Math.min(fx.width, fx.height);
      const heat = Math.max(0, 1 - (u - fx.slip) / 0.4);
      const rgb = heat > 0.5 ? '255, 255, 255' : heat > 0.2 ? '184, 201, 232' : '98, 200, 244';
      ctx.strokeStyle = `rgba(${rgb}, ${(0.3 + 0.6 * heat).toFixed(3)})`;
      ctx.lineWidth = 1.6 + 2.2 * heat;
      ctx.beginPath();
      for (const s of [1, -1]) {
        const ox = s * fx.nx * sep;
        const oy = s * fx.ny * sep;
        ctx.moveTo(ax + ox, ay + oy);
        ctx.lineTo(bx + ox, by + oy);
      }
      ctx.stroke();
    }

    if (hasBox) ctx.restore();
    ctx.restore();
  }
}

// 刀光：一条前细后粗的多边形带 + 靠近刀尖的高亮 + 一条细的中轴线
export function renderMultiLayerTrail(ctx, points, maxWidth, alpha) {
  if (!points || points.length < 2) return;

  const len = points.length;
  const leftPts = [];
  const rightPts = [];

  for (let i = 0; i < len; i++) {
    const p = points[i];
    let nx = 0;
    let ny = 0;
    let dx = 0;
    let dy = 0;

    if (i > 0 && i < len - 1) {
      dx = points[i + 1].x - points[i - 1].x;
      dy = points[i + 1].y - points[i - 1].y;
    } else if (i === 0) {
      dx = points[1].x - p.x;
      dy = points[1].y - p.y;
    } else {
      dx = p.x - points[i - 1].x;
      dy = p.y - points[i - 1].y;
    }

    const dist = Math.hypot(dx, dy);
    if (dist > 0.001) {
      nx = -dy / dist;
      ny = dx / dist;
    }

    const ratio = i / (len - 1);
    const currentWidth = maxWidth * Math.pow(ratio, 1.5) * alpha;

    leftPts.push({ x: p.x + nx * currentWidth, y: p.y + ny * currentWidth });
    rightPts.push({ x: p.x - nx * currentWidth, y: p.y - ny * currentWidth });
  }

  const poly = [...leftPts, ...rightPts.reverse()];

  ctx.fillStyle = `rgba(80, 200, 255, ${alpha * 0.25})`;
  ctx.beginPath();
  ctx.moveTo(poly[0].x, poly[0].y);
  for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = `rgba(230, 250, 255, ${alpha * 0.8})`;
  const tip = points[len - 1];
  ctx.beginPath();
  ctx.moveTo(leftPts[0].x * 0.3 + tip.x * 0.7, leftPts[0].y * 0.3 + tip.y * 0.7);
  for (let i = 1; i < len; i++) {
    const ix = leftPts[i].x * 0.4 + tip.x * 0.6;
    const iy = leftPts[i].y * 0.4 + tip.y * 0.6;
    ctx.lineTo(ix, iy);
  }
  ctx.lineTo(tip.x, tip.y);
  for (let i = len - 1; i >= 0; i--) {
    const ix = rightPts[i].x * 0.4 + tip.x * 0.6;
    const iy = rightPts[i].y * 0.4 + tip.y * 0.6;
    ctx.lineTo(ix, iy);
  }
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = `rgba(255, 255, 255, ${alpha * 0.9})`;
  ctx.lineWidth = 1;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let i = 0; i < len; i++) {
    if (i === 0) ctx.moveTo(points[i].x, points[i].y);
    else ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.stroke();
}

export function drawEffects(ctx, state, config) {
  const trailDraw = config && config.bladeStyle === 'slash' ? renderSlashWipeTrail : renderMultiLayerTrail;
  for (let i = state.flashes.length - 1; i >= 0; i--) {
    const f = state.flashes[i];

    f.alpha -= f.fade;
    if (f.alpha <= 0) {
      state.flashes.splice(i, 1);
      continue;
    }

    ctx.save();
    trailDraw(ctx, f.trail, 22, f.alpha);

    if (f.hitPoint) {
      ctx.fillStyle = `rgba(255, 255, 255, ${f.alpha})`;
      ctx.beginPath();
      ctx.arc(f.hitPoint.x, f.hitPoint.y, 6 * f.alpha, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = `rgba(0, 255, 204, ${f.alpha})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(f.hitPoint.x - 15 * f.alpha, f.hitPoint.y);
      ctx.lineTo(f.hitPoint.x + 15 * f.alpha, f.hitPoint.y);
      ctx.moveTo(f.hitPoint.x, f.hitPoint.y - 15 * f.alpha);
      ctx.lineTo(f.hitPoint.x, f.hitPoint.y + 15 * f.alpha);
      ctx.stroke();
    }
    ctx.restore();
  }

  if (state.lockedTargets.size > 0) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 100, 100, 0.8)';
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 4]);

    for (const [, rec] of state.lockedTargets.entries()) {
      const cuts = rec && rec.cuts ? rec.cuts : [];
      for (const cut of cuts) {
        const dx = cut.hitPoint.x - cut.entry.x;
        const dy = cut.hitPoint.y - cut.entry.y;
        const len = Math.hypot(dx, dy);
        let ex = 0;
        let ey = 0;
        if (len > 0) {
          ex = (dx / len) * 26;
          ey = (dy / len) * 26;
        }

        const x1 = cut.entry.x - ex;
        const y1 = cut.entry.y - ey;
        const x2 = cut.hitPoint.x + ex;
        const y2 = cut.hitPoint.y + ey;

        ctx.strokeStyle = 'rgba(0, 255, 204, 0.26)';
        ctx.lineWidth = 7;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        ctx.strokeStyle = 'rgba(180, 255, 245, 0.85)';
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.beginPath();
        ctx.arc(cut.hitPoint.x, cut.hitPoint.y, 3.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  // 逐刀落线：已落下的刀变亮，未落的保持暗线。全程静态，不闪烁。
  if (state.cutSequence && state.cutSequence.cuts) {
    const { cuts, index } = state.cutSequence;

    ctx.save();
    ctx.setLineDash([]);
    ctx.lineCap = 'round';

    for (let i = 0; i < cuts.length; i++) {
      const c = cuts[i];
      const dx = c.hitPoint.x - c.entry.x;
      const dy = c.hitPoint.y - c.entry.y;
      const len = Math.hypot(dx, dy) || 1;
      const ex = (dx / len) * 30;
      const ey = (dy / len) * 30;

      const x1 = c.entry.x - ex;
      const y1 = c.entry.y - ey;
      const x2 = c.hitPoint.x + ex;
      const y2 = c.hitPoint.y + ey;

      if (i < index) {
        ctx.strokeStyle = 'rgba(0, 255, 204, 0.5)';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      } else {
        ctx.strokeStyle = 'rgba(150, 205, 225, 0.26)';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  if (state.shockwaves && state.shockwaves.length) {
    for (let i = state.shockwaves.length - 1; i >= 0; i--) {
      const w = state.shockwaves[i];
      w.r += 16;
      w.alpha -= 0.045;
      if (w.alpha <= 0) {
        state.shockwaves.splice(i, 1);
        continue;
      }
      ctx.save();
      ctx.strokeStyle = `rgba(150, 255, 240, ${w.alpha * 0.7})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(w.x, w.y, w.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  if (state.flashWhite > 0.01) {
    ctx.save();
    ctx.fillStyle = `rgba(255, 255, 255, ${state.flashWhite * 0.42})`;
    ctx.fillRect(0, 0, state.cssW, state.cssH);
    ctx.restore();

    state.flashWhite *= 0.82;
    if (state.flashWhite < 0.01) state.flashWhite = 0;
  }
}

export function drawTargetBoxes(ctx, state) {
  if (!state.isDrawing && state.lockedTargets.size === 0) return;

  const drawBox = (rect, color) => {
    ctx.fillStyle =
      color === '#00ffcc' ? 'rgba(120, 200, 255, 0.08)' : 'rgba(255, 100, 100, 0.05)';
    ctx.fillRect(rect.left, rect.top, rect.width, rect.height);

    const cornerLen = Math.min(20, rect.width / 3, rect.height / 3);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';

    ctx.beginPath();
    ctx.moveTo(rect.left, rect.top + cornerLen);
    ctx.lineTo(rect.left, rect.top);
    ctx.lineTo(rect.left + cornerLen, rect.top);
    ctx.moveTo(rect.right - cornerLen, rect.top);
    ctx.lineTo(rect.right, rect.top);
    ctx.lineTo(rect.right, rect.top + cornerLen);
    ctx.moveTo(rect.right, rect.bottom - cornerLen);
    ctx.lineTo(rect.right, rect.bottom);
    ctx.lineTo(rect.right - cornerLen, rect.bottom);
    ctx.moveTo(rect.left + cornerLen, rect.bottom);
    ctx.lineTo(rect.left, rect.bottom);
    ctx.lineTo(rect.left, rect.bottom - cornerLen);
    ctx.stroke();
  };

  if (state.isDrawing) {
    for (const [el] of state.activeHits.entries()) {
      drawBox(el.getBoundingClientRect(), '#00ffcc');
    }
  }
  for (const [el] of state.lockedTargets.entries()) {
    drawBox(el.getBoundingClientRect(), '#ff6464');
  }
}

export function drawTrail(ctx, state, config) {
  const t = state.trail;
  if (t.length < 2) return;

  const tNow = now();
  const validPts = [];
  for (let i = 0; i < t.length; i++) {
    if (tNow - t[i].t <= config.trailLifeMs) validPts.push(t[i]);
  }
  if (validPts.length < 2) return;

  ctx.save();
  const life = 1 - (tNow - t[0].t) / config.trailLifeMs;
  const trailDraw = config && config.bladeStyle === 'slash' ? renderSlashWipeTrail : renderMultiLayerTrail;
  trailDraw(ctx, validPts, 14, Math.max(0, life));
  ctx.restore();
}

export function updateParticles(ctx, state, onEvent) {
  for (let i = state.particles.length - 1; i >= 0; i--) {
    const p = state.particles[i];
    p.x += p.vx;
    p.y += p.vy;

    if (p.isSmoke) {
      // 烟雾：缓慢上升、逐渐膨胀、无重力
      p.vx *= 0.98;
      p.vy *= 0.99;
      p.life -= p.decay;
      p.size += 0.16;
    } else if (p.isShell) {
      // 弹壳：抛物线飞出、翻滚，落地后弹跳
      p.vy += 0.9;
      p.vx *= 0.995;
      p.spin = (p.spin || 0) + 0.3;
      p.life -= p.decay;

      const ground = window.innerHeight - 18;
      if (p.y > ground && p.vy > 0) {
        p.y = ground;
        p.vy = -Math.abs(p.vy) * 0.45;
        p.vx *= 0.65;
        p.bounces = (p.bounces || 0) + 1;

        if (p.bounces <= 3 && typeof onEvent === 'function') onEvent('shellDrop');

        if (Math.abs(p.vy) < 1.4) {
          p.vy = 0;
          p.vx *= 0.4;
          p.decay = p.decay * 2.5;
        }
      }
    } else {
      p.vy += p.isChunk ? 1.2 : 0.8;
      p.vx *= 0.96;
      p.vy *= 0.98;
      p.life -= p.decay;
      if (!p.isChunk) p.size *= 0.96;
    }

    if (p.life <= 0) {
      state.particles.splice(i, 1);
      continue;
    }

    ctx.save();
    ctx.globalAlpha = Math.max(0, p.life) * (p.isSmoke ? 0.45 : 1);
    ctx.fillStyle = p.color;

    if (p.isSmoke) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    } else if (p.isShell) {
      ctx.translate(p.x, p.y);
      ctx.rotate(p.spin || 0);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      // 顶部高光，避免小铜块糊成一团
      ctx.fillStyle = 'rgba(255, 250, 224, 0.95)';
      ctx.fillRect(-p.size / 2 + 1, -p.size / 4, p.size * 0.55, 1.6);
    } else if (p.isChunk) {
      ctx.translate(p.x, p.y);
      ctx.rotate(p.x * 0.05);
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
    } else {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

// 弹道：从枪口到命中点的细线，快速淡出
export function drawTracers(ctx, state) {
  if (!state.tracers || !state.tracers.length) return;

  ctx.save();
  ctx.lineCap = 'round';

  for (let i = state.tracers.length - 1; i >= 0; i--) {
    const t = state.tracers[i];
    t.alpha -= 0.16;
    if (t.alpha <= 0) {
      state.tracers.splice(i, 1);
      continue;
    }

    ctx.strokeStyle = `rgba(255, 236, 170, ${t.alpha * 0.85})`;
    ctx.lineWidth = 1 + 1.6 * t.alpha;
    ctx.beginPath();
    ctx.moveTo(t.x1, t.y1);
    ctx.lineTo(t.x2, t.y2);
    ctx.stroke();
  }

  ctx.restore();
}

// 射击引导：枪口标记 + 朝向光标的虚线
export function drawFiringGuide(ctx, state) {
  const f = state.firing;
  if (!f || !f.active || !f.muzzle) return;

  const aim = f.aim || f.muzzle;

  ctx.save();
  ctx.setLineDash([6, 6]);
  ctx.strokeStyle = 'rgba(255, 200, 120, 0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(f.muzzle.x, f.muzzle.y);
  ctx.lineTo(aim.x, aim.y);
  ctx.stroke();

  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(255, 214, 140, 0.9)';
  ctx.beginPath();
  ctx.arc(f.muzzle.x, f.muzzle.y, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// 枪口火光：短暂的一团亮斑
export function drawMuzzleFlash(ctx, state) {
  const f = state.muzzleFlash;
  if (!f) return;

  const left = f.until - now();
  if (left <= 0) {
    state.muzzleFlash = null;
    return;
  }

  const k = Math.min(1, left / 70);
  const dx = Number.isFinite(f.dx) ? f.dx : 1;
  const dy = Number.isFinite(f.dy) ? f.dy : 0;
  const nx = -dy;
  const ny = dx;

  const len = 34;
  const halfBase = 9;

  ctx.save();
  ctx.globalAlpha = k;

  // 外层橙焰：宽而短
  const outerLen = len * (0.85 + Math.random() * 0.4);
  ctx.beginPath();
  ctx.moveTo(f.x + nx * halfBase, f.y + ny * halfBase);
  ctx.quadraticCurveTo(
    f.x + dx * outerLen * 0.6 + nx * halfBase * 1.6,
    f.y + dy * outerLen * 0.6 + ny * halfBase * 1.6,
    f.x + dx * outerLen,
    f.y + dy * outerLen
  );
  ctx.quadraticCurveTo(
    f.x + dx * outerLen * 0.6 - nx * halfBase * 1.6,
    f.y + dy * outerLen * 0.6 - ny * halfBase * 1.6,
    f.x - nx * halfBase,
    f.y - ny * halfBase
  );
  ctx.closePath();
  const outer = ctx.createLinearGradient(f.x, f.y, f.x + dx * outerLen, f.y + dy * outerLen);
  outer.addColorStop(0, 'rgba(255, 210, 120, 0.95)');
  outer.addColorStop(0.45, 'rgba(255, 150, 40, 0.75)');
  outer.addColorStop(1, 'rgba(255, 90, 20, 0)');
  ctx.fillStyle = outer;
  ctx.fill();

  // 内层白焰：窄而亮
  const innerLen = outerLen * 0.62;
  ctx.beginPath();
  ctx.moveTo(f.x + nx * halfBase * 0.42, f.y + ny * halfBase * 0.42);
  ctx.lineTo(f.x + dx * innerLen + nx * halfBase * 0.15, f.y + dy * innerLen + ny * halfBase * 0.15);
  ctx.lineTo(f.x + dx * innerLen - nx * halfBase * 0.15, f.y + dy * innerLen - ny * halfBase * 0.15);
  ctx.lineTo(f.x - nx * halfBase * 0.42, f.y - ny * halfBase * 0.42);
  ctx.closePath();
  ctx.fillStyle = 'rgba(255, 252, 232, 0.92)';
  ctx.fill();

  // 乱窜的火舌
  for (let i = 0; i < 3; i++) {
    const spread = (Math.random() - 0.5) * 0.9;
    const sx = Math.cos(spread);
    const sy = Math.sin(spread);
    const spikeLen = 10 + Math.random() * 14;
    ctx.beginPath();
    ctx.moveTo(f.x, f.y);
    ctx.lineTo(f.x + (dx * sx - dy * sy) * spikeLen, f.y + (dy * sx + dx * sy) * spikeLen);
    ctx.lineTo(f.x + dx * 4, f.y + dy * 4);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255, 190, 90, 0.7)';
    ctx.fill();
  }

  // 枪口处的小亮核
  ctx.beginPath();
  ctx.arc(f.x, f.y, 5, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 245, 210, 0.9)';
  ctx.fill();

  ctx.restore();
}

// 左轮弹仓：左下角显示剩余弹药，位于计分板上方
export function drawChambers(ctx, state, config) {
  if (!config || config.weapon !== 'revolver') return;

  const total = Math.max(1, Math.floor(config.revolverChambers) || 6);
  const R = 42;
  const cx = 24 + R;
  const cy = Math.max(R + 8, state.cssH - 132);
  const reloading = state.reloadingUntil > now();
  const reloadMs = Math.max(1, config.revolverReloadMs || 1600);

  // 换弹时弹巢旋转
  let spin = 0;
  if (reloading) {
    const elapsed = reloadMs - (state.reloadingUntil - now());
    spin = (elapsed / reloadMs) * Math.PI * 2;
  }

  ctx.save();

  // 弹巢主体
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(16, 19, 25, 0.92)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 214, 140, 0.7)';
  ctx.lineWidth = 2;
  ctx.stroke();

  // 边缘凹槽：每两个弹室之间一道缺口
  ctx.strokeStyle = 'rgba(255, 214, 140, 0.45)';
  ctx.lineWidth = 1.6;
  for (let i = 0; i < total; i++) {
    const a = -Math.PI / 2 + spin + ((i + 0.5) / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * R * 0.82, cy + Math.sin(a) * R * 0.82);
    ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
    ctx.stroke();
  }

  // 六个弹室
  const orbit = R * 0.58;
  const chamberR = R * 0.24;

  for (let i = 0; i < total; i++) {
    const a = -Math.PI / 2 + spin + (i / total) * Math.PI * 2;
    const x = cx + Math.cos(a) * orbit;
    const y = cy + Math.sin(a) * orbit;

    ctx.beginPath();
    ctx.arc(x, y, chamberR, 0, Math.PI * 2);

    if (i < state.chambers) {
      ctx.fillStyle = 'rgba(255, 214, 140, 0.92)';
      ctx.fill();
    } else {
      ctx.strokeStyle = 'rgba(255, 214, 140, 0.4)';
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }
  }

  // 中心轴
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.11, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255, 214, 140, 0.55)';
  ctx.lineWidth = 1.6;
  ctx.stroke();

  if (reloading) {
    ctx.fillStyle = 'rgba(255, 214, 140, 0.85)';
    ctx.font = '12px system-ui, -apple-system, sans-serif';
    ctx.fillText('换弹中…', cx - 18, cy + R + 18);
  }

  ctx.restore();
}

export function drawCloseButton(ctx, state) {
  const size = 36;
  const pad = 16;
  const x = window.innerWidth - size - pad;
  const y = pad;
  state.closeBtn = { x, y, w: size, h: size };

  ctx.save();
  ctx.globalAlpha = 0.88;
  ctx.fillStyle = 'rgba(18,20,26,0.92)';
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x + size * 0.32, y + size * 0.32);
  ctx.lineTo(x + size * 0.68, y + size * 0.68);
  ctx.moveTo(x + size * 0.68, y + size * 0.32);
  ctx.lineTo(x + size * 0.32, y + size * 0.68);
  ctx.stroke();
  ctx.restore();
}

// 黑洞的吸积盘：倾斜的椭圆环带，内圈更热更快，虚线偏移当旋转。
// 参考 pixelfx（MIT）的 black-hole：分层差速 + 远侧被引力弯折到洞顶。
const DISK_TILT = -0.18;
const DISK_SQUASH = 0.42;
const DISK_BANDS = [
  { r: 1.05, w: 0.055, dash: 0.22, speed: 3.4, rgb: '236, 228, 255', alpha: 0.7 },
  { r: 1.16, w: 0.05, dash: 0.18, speed: 2.4, rgb: '176, 150, 255', alpha: 0.6 },
  { r: 1.3, w: 0.045, dash: 0.15, speed: 1.5, rgb: '112, 208, 236', alpha: 0.4 },
  { r: 1.44, w: 0.038, dash: 0.12, speed: 0.95, rgb: '88, 176, 216', alpha: 0.26 },
];

// half: 'back' 画上半（远侧），'front' 画下半（近侧）
function drawDisk(ctx, cx, cy, R, t, half) {
  const a0 = half === 'back' ? Math.PI : 0;
  const a1 = a0 + Math.PI;

  ctx.save();
  ctx.lineCap = 'butt';
  for (const band of DISK_BANDS) {
    const r = R * band.r;
    const dash = Math.max(3, r * band.dash);

    // 先铺一层连续底，避免缝隙把盘面读成零散色块
    ctx.setLineDash([]);
    ctx.strokeStyle = `rgba(${band.rgb}, ${(band.alpha * 0.32).toFixed(3)})`;
    ctx.lineWidth = Math.max(1, R * band.w * 1.7);
    ctx.beginPath();
    ctx.ellipse(cx, cy, r, r * DISK_SQUASH, DISK_TILT, a0, a1);
    ctx.stroke();

    // 再叠虚线：偏移量反向推进 = 条纹在转，内圈快外圈慢
    ctx.strokeStyle = `rgba(${band.rgb}, ${band.alpha})`;
    ctx.lineWidth = Math.max(1, R * band.w);
    ctx.setLineDash([dash, dash * 0.45]);
    ctx.lineDashOffset = -((t / 1000) * band.speed * r * 0.35);
    ctx.beginPath();
    ctx.ellipse(cx, cy, r, r * DISK_SQUASH, DISK_TILT, a0, a1);
    ctx.stroke();
  }

  // 多普勒：朝向观察者的一侧更亮一档
  const hot = DISK_BANDS[0];
  const hr = R * hot.r;
  const hd = Math.max(3, hr * hot.dash);
  ctx.setLineDash([hd, hd * 1.6]);
  ctx.lineDashOffset = -((t / 1000) * hot.speed * hr * 0.35);
  ctx.strokeStyle = 'rgba(255, 250, 240, 0.5)';
  ctx.lineWidth = Math.max(1, R * hot.w * 0.5);
  ctx.beginPath();
  ctx.ellipse(cx, cy, hr, hr * DISK_SQUASH, DISK_TILT, a0 + Math.PI * 0.55, a1 - Math.PI * 0.12);
  ctx.stroke();

  ctx.setLineDash([]);
  ctx.restore();
}

// 引力透镜：远侧盘面绕过洞顶的一道弧，以及洞底折出的细弱次级像
function drawLensed(ctx, cx, cy, R, t) {
  ctx.save();
  ctx.lineCap = 'butt';

  const arc = R * 1.12;
  ctx.setLineDash([Math.max(3, arc * 0.2), Math.max(4, arc * 0.14)]);
  ctx.lineDashOffset = -((t / 1000) * 2.2 * R) % (arc * 0.34);
  ctx.strokeStyle = 'rgba(198, 182, 255, 0.34)';
  ctx.lineWidth = Math.max(1, R * 0.05);
  ctx.beginPath();
  ctx.ellipse(cx, cy - R * 0.16, arc, arc * 0.5, DISK_TILT * 0.6, Math.PI, Math.PI * 2);
  ctx.stroke();

  ctx.setLineDash([]);
  ctx.strokeStyle = 'rgba(150, 132, 255, 0.22)';
  ctx.lineWidth = Math.max(1, R * 0.03);
  ctx.beginPath();
  ctx.ellipse(cx, cy + R * 0.14, R * 1.04, R * 0.34, DISK_TILT, 0.15, Math.PI - 0.15);
  ctx.stroke();

  ctx.restore();
}

// 3D 版黑洞：倾斜差速吸积盘 + 引力透镜弧 + 事件视界 + 光子环 + 外沿吸附丝 + 剩余时间细弧。
// 只用暗色与低饱和冷色，避免整屏闪烁。
function drawBlackholesDisk(ctx, state) {
  const hole = state.blackholes && state.blackholes[0];
  if (!hole) return;

  const t = now();
  const R = hole.radius;
  if (R < 1) return;

  const span = hole.shrinkUntil ? Math.max(1, hole.shrinkUntil - hole.shrinkStart) : 0;
  const shrink = span ? Math.min(1, Math.max(0, (t - hole.shrinkStart) / span)) : 0;
  const pulse = 1 + Math.sin(t / 180) * 0.03;
  const field = R * 1.5;

  ctx.save();

  // 引力场边界：很淡的虚线，说明能吸到哪
  ctx.setLineDash([6, 8]);
  ctx.strokeStyle = 'rgba(126, 112, 200, 0.22)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(hole.x, hole.y, field, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // 盘的外层光晕
  const halo = ctx.createRadialGradient(hole.x, hole.y, R * 0.8, hole.x, hole.y, R * 1.9);
  halo.addColorStop(0, 'rgba(120, 92, 220, 0.22)');
  halo.addColorStop(0.6, 'rgba(70, 50, 140, 0.1)');
  halo.addColorStop(1, 'rgba(20, 10, 40, 0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(hole.x, hole.y, R * 1.9, 0, Math.PI * 2);
  ctx.fill();

  // 远侧盘面（上半），随后被视界压掉一部分
  drawDisk(ctx, hole.x, hole.y, R * pulse, t, 'back');

  // 远侧被弯折到洞顶的透镜像 + 洞底的细弱次级像
  drawLensed(ctx, hole.x, hole.y, R * pulse, t);

  // 事件视界：一圈柔软过渡再压成纯黑
  const veil = ctx.createRadialGradient(hole.x, hole.y, R * 0.9, hole.x, hole.y, R * 1.22);
  veil.addColorStop(0, 'rgba(0, 0, 0, 0.95)');
  veil.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = veil;
  ctx.beginPath();
  ctx.arc(hole.x, hole.y, R * 1.22, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.arc(hole.x, hole.y, R, 0, Math.PI * 2);
  ctx.fill();

  // 近侧盘面（下半）压在视界下沿之前
  drawDisk(ctx, hole.x, hole.y, R * pulse, t, 'front');

  // 光子环：外层柔光 + 内层亮线
  ctx.strokeStyle = 'rgba(170, 140, 255, 0.25)';
  ctx.lineWidth = Math.max(2, R * 0.07);
  ctx.beginPath();
  ctx.arc(hole.x, hole.y, R, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(240, 234, 255, 0.85)';
  ctx.lineWidth = Math.max(1.2, R * 0.028);
  ctx.beginPath();
  ctx.arc(hole.x, hole.y, R, 0, Math.PI * 2);
  ctx.stroke();

  // 吸附丝：从场边缘向内收的短线，随时间绕行
  for (let i = 0; i < 12; i++) {
    const phase = (t / 700 + i / 12) % 1;
    const angle = (i / 12) * Math.PI * 2 + t / 1100;
    const r0 = field * (0.98 - phase * 0.3);
    const r1 = r0 - field * 0.12;
    const alpha = 0.1 + 0.16 * Math.sin(Math.PI * phase);
    ctx.strokeStyle = `rgba(150, 132, 255, ${alpha.toFixed(3)})`;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(hole.x + Math.cos(angle) * r0, hole.y + Math.sin(angle) * r0);
    ctx.lineTo(hole.x + Math.cos(angle) * r1, hole.y + Math.sin(angle) * r1);
    ctx.stroke();
  }

  // 寿命段：按住时画满圈，收束时逐渐收短
  const left = hole.shrinkUntil ? 1 - shrink : 1;
  ctx.strokeStyle = 'rgba(0, 255, 204, 0.55)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(hole.x, hole.y, field * 1.06, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left);
  ctx.stroke();

  ctx.restore();
}

// 2D 版黑洞（参考 pixelfx 的 void-orb，MIT）：三臂漩涡 + 爱因斯坦环 + 爬行亮边。
// 漩涡收在 1.5R 的引力场以内，看到的范围就是能吸到的范围。
const VOID_ARMS = 3;

function drawVortex(ctx, cx, cy, R, t) {
  const inner = R * 1.14;
  const outer = R * 1.44;
  const spin = t / 1100;

  ctx.save();
  ctx.lineCap = 'round';

  for (let arm = 0; arm < VOID_ARMS; arm++) {
    const base = (arm / VOID_ARMS) * Math.PI * 2;
    const pts = [];
    for (let i = 0; i <= 26; i++) {
      const u = i / 26;
      const r = outer - (outer - inner) * u;
      // 绕两圈多才读得出「卷入」，太少会像同心圆
      const a = base + spin + u * 6.2;
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }

    // 尘带
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.strokeStyle = 'rgba(96, 76, 156, 0.24)';
    ctx.lineWidth = Math.max(2, R * 0.07);
    ctx.stroke();

    // 亮丝：沿同一条臂向内流动的虚线
    ctx.setLineDash([Math.max(2, R * 0.07), Math.max(2, R * 0.1)]);
    ctx.lineDashOffset = -((t / 12) % (R * 0.17));
    ctx.strokeStyle = 'rgba(198, 182, 255, 0.42)';
    ctx.lineWidth = Math.max(1, R * 0.018);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // 被吸进去的尘点：越靠里转得越快
  for (let i = 0; i < 8; i++) {
    const seed = (i * 0.618) % 1;
    const u = (t / 1600 + seed) % 1;
    const r = outer - (outer - inner) * u;
    const a = seed * Math.PI * 2 + spin + u * 3.4;
    const alpha = Math.min(1, u * 3) * (1 - u * 0.75);
    ctx.fillStyle = `rgba(242, 238, 255, ${alpha.toFixed(2)})`;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, Math.max(1, R * 0.016), 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

// 光绕过洞口的爱因斯坦环：三段不同速度的弧，吞噬时整体更亮
function drawEinsteinRing(ctx, cx, cy, R, t, gulp) {
  for (let k = 0; k < 3; k++) {
    const rr = R * (1.08 + k * 0.025);
    const start = (t / (1400 + k * 600)) * (k % 2 ? -1 : 1);
    ctx.strokeStyle = `rgba(214, 204, 255, ${(0.3 - k * 0.07 + gulp * 0.2).toFixed(3)})`;
    ctx.lineWidth = Math.max(1, R * (0.02 - k * 0.004));
    ctx.beginPath();
    ctx.arc(cx, cy, rr, start, start + Math.PI * (0.6 + k * 0.2));
    ctx.stroke();
  }
}

// 2D 版主体：平面奇点 + 三臂漩涡 + 爱因斯坦环 + 吞噬脉冲环 + 剩余时间细弧。
// 只用暗色与低饱和冷色，避免整屏闪烁。
function drawBlackholesFlat(ctx, state) {
  const hole = state.blackholes && state.blackholes[0];
  if (!hole) return;

  const t = now();
  const R = hole.radius;
  if (R < 1) return;

  const span = hole.shrinkUntil ? Math.max(1, hole.shrinkUntil - hole.shrinkStart) : 0;
  const shrink = span ? Math.min(1, Math.max(0, (t - hole.shrinkStart) / span)) : 0;
  const pulse = 1 + Math.sin(t / 180) * 0.03;
  const field = R * 1.5;

  ctx.save();

  // 引力场边界：很淡的虚线，说明能吸到哪
  ctx.setLineDash([6, 8]);
  ctx.strokeStyle = 'rgba(126, 112, 200, 0.22)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(hole.x, hole.y, field, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // 外围光晕
  const halo = ctx.createRadialGradient(hole.x, hole.y, R * 0.9, hole.x, hole.y, R * 2.4);
  halo.addColorStop(0, 'rgba(118, 92, 210, 0.2)');
  halo.addColorStop(0.55, 'rgba(66, 48, 132, 0.09)');
  halo.addColorStop(1, 'rgba(18, 10, 36, 0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(hole.x, hole.y, R * 2.4, 0, Math.PI * 2);
  ctx.fill();

  // 吞噬脉冲：吃掉目标的一瞬间亮一下（engine 在成长处写 hole.pulseAt）
  const gulp = hole.pulseAt ? Math.max(0, 1 - (t - hole.pulseAt) / 260) : 0;

  // 三臂漩涡
  drawVortex(ctx, hole.x, hole.y, R * pulse, t);

  // 爱因斯坦环
  drawEinsteinRing(ctx, hole.x, hole.y, R * pulse, t, gulp);

  // 视界：柔软过渡再压成纯黑
  const veil = ctx.createRadialGradient(hole.x, hole.y, R * 0.92, hole.x, hole.y, R * 1.1);
  veil.addColorStop(0, 'rgba(0, 0, 0, 1)');
  veil.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = veil;
  ctx.beginPath();
  ctx.arc(hole.x, hole.y, R * 1.1, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.arc(hole.x, hole.y, R, 0, Math.PI * 2);
  ctx.fill();

  // 爬行亮边：两段不同速度的弧绕着洞沿转
  for (let k = 0; k < 2; k++) {
    const start = (t / (900 + k * 700)) * (k ? -1 : 1);
    ctx.strokeStyle = k ? 'rgba(168, 148, 255, 0.5)' : 'rgba(238, 232, 255, 0.72)';
    ctx.lineWidth = Math.max(1.2, R * (0.036 - k * 0.012));
    ctx.beginPath();
    ctx.arc(hole.x, hole.y, R * 0.995, start, start + Math.PI * (1.3 - k * 0.45));
    ctx.stroke();
  }

  // 光子柔光
  ctx.strokeStyle = `rgba(160, 138, 255, ${(0.2 + gulp * 0.25).toFixed(3)})`;
  ctx.lineWidth = Math.max(2, R * 0.06);
  ctx.beginPath();
  ctx.arc(hole.x, hole.y, R, 0, Math.PI * 2);
  ctx.stroke();

  // 吞噬脉冲环
  if (gulp > 0.02) {
    ctx.strokeStyle = `rgba(255, 255, 255, ${(0.45 * gulp).toFixed(3)})`;
    ctx.lineWidth = Math.max(1, R * 0.05 * gulp);
    ctx.beginPath();
    ctx.arc(hole.x, hole.y, R * (1 + (1 - gulp) * 0.5), 0, Math.PI * 2);
    ctx.stroke();
  }

  // 寿命段：按住时画满圈，收束时逐渐收短
  const left = hole.shrinkUntil ? 1 - shrink : 1;
  ctx.strokeStyle = 'rgba(0, 255, 204, 0.55)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(hole.x, hole.y, field * 1.06, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left);
  ctx.stroke();

  ctx.restore();
}

// 唯一的绘制入口：按 blackholeStyle 分发。config 缺省时走 3D 版，兼容旧调用。
export function drawBlackholes(ctx, state, config) {
  if (config && config.blackholeStyle === '2d') drawBlackholesFlat(ctx, state);
  else drawBlackholesDisk(ctx, state);
}

// 炮 · 玻璃碎裂（Shatter wipe）的 canvas 叠加层。
// DOM 楔形碎片由 shatter.js 生成，这里补上像素效果里最标志性的部分：
// 裂纹按距离「赛跑」向外推进、撞击白闪、炸裂冷闪与飞散的玻璃碎屑。
// 时间轴是归一化的 u∈[0,1]，关键时刻由 spawnShatterWipe 随 pattern 一起返回，避免两处定义漂移。

function shatterFlash(ctx, cx, cy, radius, rgb, alpha) {
  if (radius <= 0 || alpha <= 0) return;
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  g.addColorStop(0, `rgba(${rgb}, ${alpha.toFixed(3)})`);
  g.addColorStop(1, `rgba(${rgb}, 0)`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
}

export function drawShatterWipes(ctx, state) {
  const list = state.shatterWipes;
  if (!list || !list.length) return;

  for (let i = list.length - 1; i >= 0; i--) {
    const fx = list[i];
    const impact = Number.isFinite(fx.impact) ? fx.impact : 0.16;
    const burst = Number.isFinite(fx.burst) ? fx.burst : 0.42;
    const u = (now() - fx.t0) / fx.durationMs;
    if (u >= 1 || u < 0) {
      list.splice(i, 1);
      continue;
    }

    ctx.save();
    ctx.lineCap = 'round';

    // 裂纹与碎屑只画在目标矩形内；闪光允许轻微溢出，但半径按目标尺寸限幅
    const hasBox = [fx.left, fx.top, fx.width, fx.height].every(Number.isFinite);
    const clipToTarget = () => {
      if (!hasBox) return;
      ctx.save();
      ctx.beginPath();
      ctx.rect(fx.left, fx.top, fx.width, fx.height);
      if (fx.hole && fx.hole.length > 2) {
        // evenodd：矩形减去弹孔，挖空的洞内不画任何裂纹或碎屑
        ctx.moveTo(fx.hole[0][0], fx.hole[0][1]);
        for (let k = 1; k < fx.hole.length; k++) ctx.lineTo(fx.hole[k][0], fx.hole[k][1]);
        ctx.closePath();
        ctx.clip('evenodd');
      } else {
        ctx.clip();
      }
    };
    const flashLimit = hasBox ? Math.max(24, Math.min(fx.width, fx.height) * 0.35) : 42;

    // 撞击：白热核心 + 十字星芒，随后快速收掉
    if (u >= impact && u < impact + 0.16) {
      const k = 1 - (u - impact) / 0.16;
      shatterFlash(ctx, fx.x, fx.y, flashLimit * (0.4 + k), '255, 255, 255', 0.85 * k);
      shatterFlash(ctx, fx.x, fx.y, flashLimit * 0.38, '216, 244, 255', 0.7 * k);
      ctx.strokeStyle = `rgba(255, 255, 255, ${(0.9 * k).toFixed(3)})`;
      ctx.lineWidth = 1.6;
      const arm = flashLimit * 0.62 * (0.5 + k);
      ctx.beginPath();
      ctx.moveTo(fx.x - arm, fx.y);
      ctx.lineTo(fx.x + arm, fx.y);
      ctx.moveTo(fx.x, fx.y - arm);
      ctx.lineTo(fx.x, fx.y + arm);
      ctx.stroke();
    }

    // 裂纹赛跑：每条折线在 t0 抵达后逐段长出，尖端由白转冷蓝。
    // 按颜色分组合并成一条 path，每帧只 stroke 数次，避免上百条线段各自 stroke。
    if (u >= impact && u < burst + 0.3) {
      const groups = [
        { rgb: '255, 255, 255', alpha: 0.95, width: 1.8, segs: [] },
        { rgb: '216, 244, 255', alpha: 0.85, width: 1.2, segs: [] },
        { rgb: '88, 180, 236', alpha: 0.4, width: 1.0, segs: [] },
      ];
      for (const c of fx.cracks) {
        if (c.t0 > u) break; // cracks 已按 t0 升序
        const age = u - c.t0;
        if (age > 0.34) continue;
        const grow = Math.min(1, age / 0.05);
        const ex = c.ax + (c.bx - c.ax) * grow;
        const ey = c.ay + (c.by - c.ay) * grow;
        const gi = age < 0.04 ? 0 : age < 0.18 ? 1 : 2;
        groups[gi].segs.push([c.ax, c.ay, ex, ey]);
      }

      if (groups.some((g) => g.segs.length > 0)) {
        clipToTarget();
        // 暗影统一铺一层，裂纹才有「裂开」的厚度
        ctx.strokeStyle = 'rgba(12, 20, 48, 0.5)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (const g of groups) {
          for (const [ax, ay, bx, by] of g.segs) {
            ctx.moveTo(ax + 1, ay + 1);
            ctx.lineTo(bx + 1, by + 1);
          }
        }
        ctx.stroke();

        for (const g of groups) {
          if (!g.segs.length) continue;
          ctx.strokeStyle = `rgba(${g.rgb}, ${g.alpha})`;
          ctx.lineWidth = g.width;
          ctx.beginPath();
          for (const [ax, ay, bx, by] of g.segs) {
            ctx.moveTo(ax, ay);
            ctx.lineTo(bx, by);
          }
          ctx.stroke();
        }
        if (hasBox) ctx.restore();
      }
    }

    // 炸裂：一圈冷色冲击光，伴着从撞击点甩出的玻璃碎屑
    if (u >= burst) {
      const k = Math.max(0, 1 - (u - burst) / 0.28);
      if (k > 0) {
        shatterFlash(ctx, fx.x, fx.y, flashLimit * (0.8 + 0.6 * k), '88, 180, 236', 0.5 * k);
        shatterFlash(ctx, fx.x, fx.y, flashLimit * 0.42, '255, 255, 255', 0.65 * k);
      }
      const fly = (u - burst) / (1 - burst);
      if (fly < 0.75) {
        const fade = 1 - fly / 0.75;
        clipToTarget();
        ctx.strokeStyle = `rgba(216, 244, 255, ${(0.6 * fade).toFixed(3)})`;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        for (let s = 0; s < 14; s++) {
          const a = (s / 14) * Math.PI * 2 + Math.sin(s * 7.13) * 0.3;
          const dist = 12 + fly * (70 + (s % 5) * 26);
          const x0 = fx.x + Math.cos(a) * dist;
          const y0 = fx.y + Math.sin(a) * dist + fly * fly * 34;
          const len = 3 + (s % 4) * 2;
          ctx.moveTo(x0, y0);
          ctx.lineTo(x0 + Math.cos(a) * len, y0 + Math.sin(a) * len + fly * 18);
        }
        ctx.stroke();
        if (hasBox) ctx.restore();
      }
    }

    ctx.restore();
  }
}

