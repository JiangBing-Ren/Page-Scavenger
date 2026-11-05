const now = () => performance.now();

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

export function drawEffects(ctx, state) {
  for (let i = state.flashes.length - 1; i >= 0; i--) {
    const f = state.flashes[i];

    f.alpha -= f.fade;
    if (f.alpha <= 0) {
      state.flashes.splice(i, 1);
      continue;
    }

    ctx.save();
    renderMultiLayerTrail(ctx, f.trail, 22, f.alpha);

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
  renderMultiLayerTrail(ctx, validPts, 14, Math.max(0, life));
  ctx.restore();
}

export function updateParticles(ctx, state) {
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
      // 弹壳：抛物线飞出、翻滚
      p.vy += 0.9;
      p.vx *= 0.995;
      p.spin = (p.spin || 0) + 0.3;
      p.life -= p.decay;
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
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
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

  ctx.save();
  ctx.globalAlpha = k;
  const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, 18);
  g.addColorStop(0, 'rgba(255, 250, 220, 0.95)');
  g.addColorStop(0.45, 'rgba(255, 200, 90, 0.6)');
  g.addColorStop(1, 'rgba(255, 140, 40, 0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(f.x, f.y, 18, 0, Math.PI * 2);
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
  const reloadMs = Math.max(1, config.revolverReloadMs || 900);

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
