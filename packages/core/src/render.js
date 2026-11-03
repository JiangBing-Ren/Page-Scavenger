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
          ex = (dx / len) * 20;
          ey = (dy / len) * 20;
        }

        ctx.beginPath();
        ctx.moveTo(cut.entry.x - ex, cut.entry.y - ey);
        ctx.lineTo(cut.hitPoint.x + ex, cut.hitPoint.y + ey);
        ctx.stroke();
      }
    }
    ctx.restore();
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

    p.vy += p.isChunk ? 1.2 : 0.8;

    p.vx *= 0.96;
    p.vy *= 0.98;
    p.life -= p.decay;
    if (!p.isChunk) p.size *= 0.96;

    if (p.life <= 0) {
      state.particles.splice(i, 1);
      continue;
    }

    ctx.save();
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.fillStyle = p.color;

    if (p.isChunk) {
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
