import { DEFAULT_CONFIG, SIZE_LEVELS } from './config.js';
import { cssPath } from './selector.js';
import { findSlashTarget } from './targeting.js';
import { spawnSparks, spawnDOMFragments, spawnMultiCutFragments, reslicePiece } from './fragments.js';
import { piecesAt, getPiece } from './pieces.js';
import { createSound } from './sound.js';
import {
  drawEffects,
  drawTargetBoxes,
  drawTrail,
  updateParticles,
  drawCloseButton,
} from './render.js';

const now = () => performance.now();

/**
 * 宿主无关的斩击引擎。宿主（扩展 / 油猴 / Electron）只负责：
 * 提供存储 adapter、决定何时 activate、把配置塞进来。
 */
export function createCleaner(options) {
  const opts = options || {};
  const storage = opts.storage || null;
  const onStateChange = typeof opts.onStateChange === 'function' ? opts.onStateChange : () => {};
  const onSlash = typeof opts.onSlash === 'function' ? opts.onSlash : () => {};

  const CONFIG = Object.assign({}, DEFAULT_CONFIG, opts.config || {});
  const sound = createSound(() => CONFIG);

  const state = {
    active: false,
    isDrawing: false,
    activeHits: new Map(),
    pieceHits: new Map(),
    lockedTargets: new Map(),
    flashes: [],
    particles: [],
    shockwaves: [],
    flashWhite: 0,
    shake: 0,
    cutSequence: null,
    batchRemaining: 0,
    canvas: null,
    ctx: null,
    dpr: 1,
    cssW: 0,
    cssH: 0,
    trail: [],
    prevPoint: null,
    rafId: null,
    observer: null,
    slashed: new WeakSet(),
    pending: new Set(),
    undoStack: [],
    closeBtn: null,
    listeners: [],
    marks: [],
    slashCount: 0,
  };

  let saveTimer = null;

  // 叠刀抬升：目标被斩超过 3 刀后抬起并放大
  const lifted = new Map();

  function applyLift(el, scale, dy) {
    if (lifted.has(el)) {
      el.style.transform = `translateY(${dy}px) scale(${scale})`;
      return;
    }

    let computed = 'none';
    try {
      computed = window.getComputedStyle(el).transform;
    } catch (e) {}

    // 站点自己用了 transform 就不碰，避免破坏布局
    if (computed !== 'none') return;

    lifted.set(el, {
      transform: el.style.transform || '',
      transition: el.style.transition || '',
      origin: el.style.transformOrigin || '',
    });
    el.style.transformOrigin = 'center center';
    el.style.transition = 'transform 0.18s ease-out';
    el.style.transform = `translateY(${dy}px) scale(${scale})`;
  }

  function releaseLift(el) {
    if (!lifted.has(el)) return;
    const prev = lifted.get(el);
    lifted.delete(el);
    try {
      el.style.transition = prev.transition;
      el.style.transformOrigin = prev.origin;
      el.style.transform = prev.transform;
    } catch (e) {}
  }

  function releaseAllLifts() {
    for (const el of Array.from(lifted.keys())) releaseLift(el);
  }

  const saveMarks = () => {
    if (!storage || typeof storage.saveMarks !== 'function') return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      try {
        storage.saveMarks(state.marks.slice());
      } catch (e) {}
    }, 200);
  };

  function addMark(sel) {
    if (!sel) return;
    if (state.marks.includes(sel)) return;
    state.marks.push(sel);
    if (state.marks.length > 200) state.marks.splice(0, state.marks.length - 200);
    saveMarks();
  }

  function removeMark(sel) {
    const idx = state.marks.indexOf(sel);
    if (idx >= 0) {
      state.marks.splice(idx, 1);
      saveMarks();
    }
  }

  function hideEl(el) {
    try {
      el.style.setProperty(CONFIG.hideProp, CONFIG.hideValue, 'important');
    } catch (e) {}
  }

  function restoreEl(el, prevStyle) {
    try {
      if (prevStyle == null) el.removeAttribute('style');
      else el.setAttribute('style', prevStyle);
    } catch (e) {}
  }

  function slash(el, hitPoint, dir, entryPoint, flashTrail) {
    if (!el || state.pending.has(el) || state.slashed.has(el)) return;

    state.pending.add(el);
    const rect = el.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) {
      state.pending.delete(el);
      return;
    }

    if (flashTrail && flashTrail.length > 1) {
      state.flashes.push({ trail: flashTrail, hitPoint, alpha: 1, fade: 0.06 });
    }

    const sel = cssPath(el);
    const prevStyle = el.getAttribute('style');
    const record = { sel, prevStyle };

    try {
      hideEl(el);
      state.slashed.add(el);
      releaseLift(el);
      if (sel) addMark(sel);
      state.undoStack.push(record);
      if (state.undoStack.length > 20) state.undoStack.shift();

      spawnDOMFragments(el, rect, hitPoint, dir, entryPoint, CONFIG.hitStop);
      spawnSparks(state.particles, rect, hitPoint, dir);
      sound.slice(1);

      state.slashCount++;
      onSlash({ el, rect, count: state.slashCount });
    } catch (e) {
      console.error(e);
      hideEl(el);
    }

    state.pending.delete(el);
  }

  // 累积一刀。同一目标可反复叠，松手后一次性切开
  function addCut(el, entry, hitPoint, dir, flashTrail) {
    let rec = state.lockedTargets.get(el);
    if (!rec) {
      rec = { rect: el.getBoundingClientRect(), cuts: [] };
      state.lockedTargets.set(el, rec);
    }

    if (rec.cuts.length >= CONFIG.maxCutsPerTarget) return;

    const last = rec.cuts[rec.cuts.length - 1];
    if (last) {
      const gap = Math.hypot(hitPoint.x - last.hitPoint.x, hitPoint.y - last.hitPoint.y);
      if (gap < CONFIG.minCutGap) return;
    }

    rec.cuts.push({ entry, hitPoint, dir, flashTrail });
  }

  // 松手后的完整流程：抬起 → 逐刀由慢到快 → 一次性炸开
  function executeCuts(el, rec) {
    if (!el || state.pending.has(el) || state.slashed.has(el)) {
      finishBatch();
      return;
    }

    const cuts = rec && rec.cuts ? rec.cuts : [];
    if (!cuts.length) {
      finishBatch();
      return;
    }

    if (cuts.length === 1) {
      const c = cuts[0];
      slash(el, c.hitPoint, c.dir, c.entry, c.flashTrail);
      finishBatch();
      return;
    }

    // 播放序列期间占位，避免同一目标被再次锁定而跑出两条序列
    state.pending.add(el);

    // 超过 3 刀才抬起；等过渡结束再取矩形，让刀线跟着元素走
    const willLift = cuts.length > 3;
    const strong = cuts.length >= 7;
    if (willLift) applyLift(el, strong ? 1.08 : 1.05, strong ? -16 : -10);

    setTimeout(
      () => {
        const rect = el.getBoundingClientRect();
        const mapped = mapCuts(cuts, rec.rect, rect);
        state.cutSequence = { cuts: mapped, index: 0 };
        runCutStep(el, rect, mapped, 0, () => explode(el, rect, mapped));
      },
      willLift ? 160 : 0
    );
  }

  // 记录时的屏幕坐标 → 当前矩形坐标（抬升/放大后仍然对齐）
  function mapCuts(cuts, from, to) {
    if (!from || !to || from.width < 1 || from.height < 1) return cuts;
    const sx = to.width / from.width;
    const sy = to.height / from.height;
    const map = (p) => ({
      x: to.left + (p.x - from.left) * sx,
      y: to.top + (p.y - from.top) * sy,
    });
    return cuts.map((c) => ({
      entry: map(c.entry),
      hitPoint: map(c.hitPoint),
      dir: { x: c.dir.x * sx, y: c.dir.y * sy },
      flashTrail: c.flashTrail,
    }));
  }

  // 逐刀落线：只推进亮线进度并出声，不做闪烁（频闪会让人不适）
  function runCutStep(el, rect, cuts, index, done) {
    if (index >= cuts.length) {
      done();
      return;
    }

    if (state.cutSequence) state.cutSequence.index = index + 1;
    sound.slice(index + 1);

    const gap = Math.max(
      CONFIG.cutStepMin,
      CONFIG.cutStepBase * Math.pow(CONFIG.cutStepDecay, index)
    );
    setTimeout(() => runCutStep(el, rect, cuts, index + 1, done), gap);
  }

  function explode(el, rect, cuts) {
    state.cutSequence = null;

    // 播放序列时已经占位了 pending，这里只判断是否已被处理过
    if (!el || state.slashed.has(el)) {
      state.pending.delete(el);
      finishBatch();
      return;
    }

    const sel = cssPath(el);
    const prevStyle = el.getAttribute('style');

    try {
      hideEl(el);
      state.slashed.add(el);
      releaseLift(el);
      if (sel) addMark(sel);

      state.undoStack.push({ sel, prevStyle });
      if (state.undoStack.length > 20) state.undoStack.shift();

      spawnMultiCutFragments(el, rect, cuts, CONFIG.hitStop);

      sound.burst();
      state.shockwaves.push({
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        r: Math.max(rect.width, rect.height) * 0.18,
        alpha: 1,
      });

      const last = cuts[cuts.length - 1];
      spawnSparks(state.particles, rect, last.hitPoint, last.dir);

      state.slashCount++;
      onSlash({ el, rect, count: state.slashCount, cuts: cuts.length });
    } catch (e) {
      console.error(e);
      hideEl(el);
    }

    state.pending.delete(el);
    finishBatch();
  }

  // 整批目标炸完后，白闪与震屏只来一次
  function finishBatch() {
    state.batchRemaining -= 1;
    if (state.batchRemaining > 0) return;
    state.batchRemaining = 0;
    state.flashWhite = 1;
    state.shake = 1;
  }

  function checkHits(x, y) {
    checkDomHits(x, y);
    if (CONFIG.comboCut) checkPieceHits(x, y);
  }

  // 连切：碎片进入/离开判定，与元素一致——从一侧进、另一侧出才算贯穿
  function checkPieceHits(x, y) {
    const hits = piecesAt(x, y, now());
    const stillInside = new Set();
    for (const item of hits) stillInside.add(item.id);

    for (const [id, entry] of state.pieceHits) {
      if (stillInside.has(id)) continue;

      state.pieceHits.delete(id);
      const item = getPiece(id);
      if (!item || !item.node.isConnected) continue;

      const rect = item.node.getBoundingClientRect();
      const dx = Math.abs(x - entry.x);
      const dy = Math.abs(y - entry.y);

      if (dx > rect.width * CONFIG.pierceRatio || dy > rect.height * CONFIG.pierceRatio) {
        spawnSparks(state.particles, rect, { x, y }, { x: x - entry.x, y: y - entry.y });
        reslicePiece(item, entry, { x, y }, 0, onSlash);
      }
    }

    for (const item of hits) {
      if (!state.pieceHits.has(item.id)) state.pieceHits.set(item.id, { x, y });
    }
  }

  function checkDomHits(x, y) {
    for (const [el, entry] of state.activeHits.entries()) {
      const rect = el.getBoundingClientRect();

      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
        const dx = Math.abs(x - entry.x);
        const dy = Math.abs(y - entry.y);

        if (dx > rect.width * CONFIG.pierceRatio || dy > rect.height * CONFIG.pierceRatio) {
          const hitPoint = { x, y };
          const dir = { x: x - entry.x, y: y - entry.y };

          const flashTrail = [];
          for (let i = 0; i < state.trail.length; i++) {
            flashTrail.push({ x: state.trail[i].x, y: state.trail[i].y });
          }

          if (CONFIG.executeOnRelease) {
            addCut(el, { x: entry.x, y: entry.y }, hitPoint, dir, flashTrail);
          } else {
            slash(el, hitPoint, dir, { x: entry.x, y: entry.y }, flashTrail);
          }
        }

        state.activeHits.delete(el);
      }
    }

    let stack;
    try {
      stack = document.elementsFromPoint(x, y);
    } catch (e) {
      return;
    }
    if (!stack || !stack.length) return;

    let hit = null;
    for (const n of stack) {
      if (!n || n.nodeType !== 1) continue;
      if (n === state.canvas || n === document.documentElement || n === document.body) continue;
      if (n.hasAttribute && n.hasAttribute('data-adslash-ui')) continue;
      hit = n;
      break;
    }
    if (!hit) return;

    const env = { config: CONFIG, marks: state.marks, canvas: state.canvas };
    const target = findSlashTarget(hit, env);
    // 已锁定的目标允许再次进入：这就是叠刀
    if (
      !target ||
      state.pending.has(target) ||
      state.slashed.has(target) ||
      state.activeHits.has(target)
    ) {
      return;
    }

    state.activeHits.set(target, { x, y });
  }

  function onPointerDown(e) {
    if (!state.active) return;

    const btn = state.closeBtn;
    if (
      btn &&
      e.clientX >= btn.x &&
      e.clientX <= btn.x + btn.w &&
      e.clientY >= btn.y &&
      e.clientY <= btn.y + btn.h
    ) {
      e.preventDefault();
      e.stopPropagation();
      deactivate();
      return;
    }

    if (e.button !== 0 && e.pointerType === 'mouse') return;

    e.preventDefault();

    state.isDrawing = true;
    state.activeHits.clear();
    state.pieceHits.clear();
    releaseAllLifts();
    state.lockedTargets.clear();

    const pt = { x: e.clientX, y: e.clientY, t: now() };
    state.prevPoint = pt;
    state.trail.push(pt);
    if (state.trail.length > CONFIG.trailLength) state.trail.shift();
  }

  function onPointerMove(e) {
    if (!state.active || !state.isDrawing) return;

    const pt = { x: e.clientX, y: e.clientY, t: now() };

    if (state.prevPoint) {
      const a = state.prevPoint;
      const b = pt;
      const dist = Math.hypot(b.x - a.x, b.y - a.y);

      if (dist > 1) {
        const steps = Math.max(1, Math.ceil(dist / CONFIG.sampleStep));
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          checkHits(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
        }
      }
    }

    state.prevPoint = pt;
    state.trail.push(pt);
    if (state.trail.length > CONFIG.trailLength) state.trail.shift();
  }

  function onPointerUp() {
    if (!state.active) return;

    state.isDrawing = false;
    state.prevPoint = null;
    state.activeHits.clear();
    state.pieceHits.clear();

    if (CONFIG.executeOnRelease && state.lockedTargets.size > 0) {
      const targets = Array.from(state.lockedTargets.entries());
      state.lockedTargets.clear();

      state.batchRemaining = targets.length;

      let delay = 0;
      for (let i = 0; i < targets.length; i++) {
        const [el, rec] = targets[i];
        setTimeout(() => executeCuts(el, rec), delay);
        delay += Math.max(50, 150 / (i + 1));
      }
    }
  }

  function onWheel(e) {
    // 只在按住左键划线时屏蔽滚动，否则长页面根本没法往下看
    if (state.active && state.isDrawing) e.preventDefault();
  }

  function onKeyDown(e) {
    if (state.active && e.key === 'Escape') {
      e.preventDefault();
      deactivate();
    }
  }

  function loop() {
    if (!state.active || !state.ctx) {
      state.rafId = null;
      return;
    }

    const ctx = state.ctx;
    ctx.clearRect(0, 0, state.cssW, state.cssH);

    const tNow = now();
    if (!state.isDrawing) {
      while (state.trail.length && tNow - state.trail[0].t > CONFIG.trailLifeMs + 40) {
        state.trail.shift();
      }
    }

    const shake = state.shake;
    const shaking = shake > 0.01;
    if (shaking) {
      ctx.save();
      ctx.translate((Math.random() - 0.5) * 12 * shake, (Math.random() - 0.5) * 12 * shake);
    }

    drawTargetBoxes(ctx, state);
    drawEffects(ctx, state);
    drawTrail(ctx, state, CONFIG);
    updateParticles(ctx, state);
    drawCloseButton(ctx, state);

    if (shaking) ctx.restore();
    state.shake *= 0.86;
    if (state.shake < 0.01) state.shake = 0;

    state.rafId = requestAnimationFrame(loop);
  }

  function resizeCanvas() {
    const c = state.canvas;
    if (!c) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;

    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    c.style.width = w + 'px';
    c.style.height = h + 'px';

    const ctx = c.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);

    state.dpr = dpr;
    state.cssW = w;
    state.cssH = h;
    state.ctx = ctx;
  }

  function bind(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    state.listeners.push({ target, type, fn, opts });
  }

  function createCanvas() {
    const c = document.createElement('canvas');
    c.dataset.adslashUi = '1';
    Object.assign(c.style, {
      position: 'fixed',
      left: '0',
      top: '0',
      zIndex: '2147483647',
      pointerEvents: 'auto',
      cursor: 'crosshair',
      touchAction: 'none',
      background: 'transparent',
      display: 'block',
    });

    const root = document.documentElement || document.body;
    if (!root) return;
    root.appendChild(c);

    state.canvas = c;
    resizeCanvas();

    bind(c, 'pointermove', onPointerMove, { passive: true });
    bind(c, 'pointerdown', onPointerDown, { passive: false });
    bind(c, 'pointerup', onPointerUp, { passive: true });
    bind(c, 'pointercancel', onPointerUp, { passive: true });
    bind(c, 'wheel', onWheel, { passive: false });
    bind(window, 'resize', resizeCanvas, { passive: true });
    bind(window, 'keydown', onKeyDown, { passive: false });
  }

  function destroyCanvas() {
    if (state.rafId) {
      cancelAnimationFrame(state.rafId);
      state.rafId = null;
    }
    for (const l of state.listeners) l.target.removeEventListener(l.type, l.fn, l.opts);
    state.listeners = [];

    if (state.canvas && state.canvas.parentNode) state.canvas.parentNode.removeChild(state.canvas);

    state.canvas = null;
    state.ctx = null;
    state.trail = [];
    state.flashes = [];
    state.particles = [];
    state.prevPoint = null;
    state.closeBtn = null;
  }

  function applyMarks() {
    if (!document.body) return;
    if (!state.marks.length) return;

    for (const sel of state.marks) {
      let nodes;
      try {
        nodes = document.querySelectorAll(sel);
      } catch (e) {
        continue;
      }
      for (const el of nodes) {
        if (state.slashed.has(el)) continue;
        hideEl(el);
        state.slashed.add(el);
      }
    }
  }

  function startObserver() {
    if (state.observer || !document.body) return;

    let timer = null;
    const obs = new MutationObserver(() => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        if (state.active) applyMarks();
      }, 120);
    });

    obs.observe(document.body, { childList: true, subtree: true });
    state.observer = obs;
  }

  function stopObserver() {
    if (state.observer) {
      state.observer.disconnect();
      state.observer = null;
    }
  }

  function activate() {
    if (state.active) return;

    state.active = true;
    createCanvas();
    startObserver();
    if (!state.rafId) state.rafId = requestAnimationFrame(loop);

    onStateChange(true);
  }

  function deactivate() {
    if (!state.active) return;

    state.active = false;
    stopObserver();
    releaseAllLifts();
    state.cutSequence = null;
    destroyCanvas();

    onStateChange(false);
  }

  function toggle() {
    if (state.active) deactivate();
    else activate();
  }

  function undoLast() {
    const rec = state.undoStack.pop();
    if (!rec) return false;

    removeMark(rec.sel);

    let el = null;
    try {
      el = document.querySelector(rec.sel);
    } catch (e) {
      el = null;
    }

    if (el) {
      restoreEl(el, rec.prevStyle);
      state.slashed.delete(el);
    }
    return true;
  }

  function clearMarks() {
    state.marks.length = 0;
    if (storage && typeof storage.clearMarks === 'function') {
      try {
        storage.clearMarks();
      } catch (e) {}
    } else {
      saveMarks();
    }
  }

  function setConfig(patch) {
    if (!patch) return CONFIG;

    for (const key of Object.keys(patch)) {
      if (!(key in DEFAULT_CONFIG)) continue;
      const value = patch[key];
      if (key === 'targetSizeLevel') {
        if (SIZE_LEVELS.indexOf(value) === -1) continue;
      }
      CONFIG[key] = value;
    }

    if (state.active) {
      applyMarks();
    }
    return CONFIG;
  }

  function getConfig() {
    return CONFIG;
  }

  const ready = (async () => {
    if (storage && typeof storage.loadMarks === 'function') {
      try {
        const saved = await storage.loadMarks();
        if (Array.isArray(saved)) state.marks = saved.slice(-200);
      } catch (e) {}
    }

    if (CONFIG.autoApplyMarks) {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', applyMarks, { once: true });
      } else {
        applyMarks();
      }
    }
  })();

  function destroy() {
    deactivate();
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
      if (storage && typeof storage.saveMarks === 'function') {
        try {
          storage.saveMarks(state.marks.slice());
        } catch (e) {}
      }
    }
  }

  return {
    ready,
    activate,
    deactivate,
    toggle,
    isActive: () => state.active,
    setConfig,
    getConfig,
    undoLast,
    clearMarks,
    getMarkCount: () => state.marks.length,
    getSlashCount: () => state.slashCount,
    // 调试/自检用：不参与游戏逻辑
    getDebugState: () => ({
      active: state.active,
      drawing: state.isDrawing,
      activeHits: state.activeHits.size,
      locked: state.lockedTargets.size,
      cuts: Array.from(state.lockedTargets.values()).map((r) => (r.cuts ? r.cuts.length : 0)),
    }),
    destroy,
  };
}
