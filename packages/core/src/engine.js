import { DEFAULT_CONFIG, SIZE_LEVELS } from './config.js';
import { cssPath } from './selector.js';
import { findSlashTarget } from './targeting.js';
import {
  spawnSparks,
  spawnDOMFragments,
  spawnMultiCutFragments,
  spawnBlastHole,
  spawnBlastCracks,
  spawnBlastBreakup,
  spawnSmoke,
  spawnShell,
  reslicePiece,
} from './fragments.js';
import { piecesAt, getPiece } from './pieces.js';
import { createSound } from './sound.js';
import { WEAPONS, getWeapon, blastSamplePoints } from './weapons.js';
import {
  drawEffects,
  drawTargetBoxes,
  drawTrail,
  updateParticles,
  drawCloseButton,
  drawTracers,
  drawFiringGuide,
  drawChambers,
  drawMuzzleFlash,
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
    lastFireAt: 0,
    firing: { active: false, muzzle: null, aim: null, lastShotAt: 0 },
    chambers: 6,
    reloadingUntil: 0,
    muzzleFlash: null,
    tracers: [],
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

  function currentWeapon() {
    const weapon = getWeapon(CONFIG.weapon);
    // 存储里若残留未实现的武器（例如手改存储），回退到刀，避免切击直接失灵
    if (weapon && weapon.implemented) return weapon;
    return getWeapon('blade');
  }

  // 目前只有「输入方式为拖动」的武器能走斩击路径，其余武器实现前不响应输入
  function canSlash() {
    const weapon = currentWeapon();
    return !!(weapon && weapon.implemented && weapon.input === 'drag');
  }

  function setWeapon(id) {
    const weapon = getWeapon(id);
    if (!weapon) return { ok: false, reason: 'unknown' };
    if (!weapon.implemented) return { ok: false, reason: 'not-implemented' };
    CONFIG.weapon = weapon.id;
    // 切到左轮时补满弹仓
    if (weapon.id === 'revolver') {
      state.chambers = Math.max(1, Math.floor(CONFIG.revolverChambers) || 6);
      state.reloadingUntil = 0;
    }
    return { ok: true, weapon: weapon.id };
  }

  // 炮：以点击点为圆心收集范围内目标，逐个摧毁。
  // 其他 click 类武器（手枪等）实现时在这里加自己的分支。
  function blastAt(cx, cy) {
    const t = now();
    if (t - state.lastFireAt < CONFIG.weaponCooldown) return;
    state.lastFireAt = t;

    const radius = CONFIG.cannonRadius;
    const env = { config: CONFIG, marks: state.marks, canvas: state.canvas };
    const found = [];
    const seen = new Set();

    for (const point of blastSamplePoints(cx, cy, radius)) {
      let stack;
      try {
        stack = document.elementsFromPoint(point.x, point.y);
      } catch (e) {
        continue;
      }
      if (!stack) continue;

      for (const node of stack) {
        if (!node || node.nodeType !== 1) continue;
        if (node === state.canvas || node === document.documentElement || node === document.body) {
          continue;
        }
        if (node.hasAttribute && node.hasAttribute('data-adslash-ui')) continue;

        const target = findSlashTarget(node, env);
        if (target && !seen.has(target)) {
          seen.add(target);
          found.push(target);
        }
        break;
      }
    }

    // 容器和它内部的元素同时命中时只保留容器，避免重复计分
    const targets = found.filter(
      (target) => !found.some((other) => other !== target && other.contains(target))
    );

    sound.play('cannonFire');
    // 炮击的冲击更重：震屏加强，双层冲击波
    state.shake = 1.25;
    state.shockwaves.push({ x: cx, y: cy, r: radius * 0.25, alpha: 1 });
    state.shockwaves.push({ x: cx, y: cy, r: radius * 0.55, alpha: 0.65 });

    for (const target of targets) {
      holeDestroy(target, cx, cy, CONFIG.cannonRadius * CONFIG.blastHoleScale, {
        breakup: true,
      });
    }

    if (!targets.length) {
      spawnSparks(
        state.particles,
        { left: cx - 8, top: cy - 8, width: 16, height: 16 },
        { x: cx, y: cy },
        { x: 1, y: 0 }
      );
    }
  }

  // 机枪：枪口固定在按下点，按住期间朝光标方向按间隔持续扫射
  function fireStep() {
    const f = state.firing;
    if (!f.active || !f.muzzle || !f.aim) return;

    const weapon = currentWeapon();
    if (!weapon || weapon.input !== 'hold') return;

    const cooldown =
      weapon.id === 'machinegun' ? CONFIG.machinegunCooldown : CONFIG.revolverCooldown;
    const holeRadius =
      weapon.id === 'machinegun' ? CONFIG.machinegunHoleRadius : CONFIG.revolverHoleRadius;
    const spread = weapon.id === 'machinegun' ? CONFIG.machinegunSpread : 0;

    const t = now();
    if (t - f.lastShotAt < cooldown) return;
    f.lastShotAt = t;

    fireBullet(f.muzzle, f.aim, { holeRadius, spread });
  }

  // 一颗子弹：沿枪口→光标做射线检测，命中最近的目标
  function fireBullet(muzzle, rawAim, options) {
    const opts = options || {};
    const spread = Number.isFinite(opts.spread) ? opts.spread : 0;
    const aim =
      spread > 0
        ? {
            x: rawAim.x + (Math.random() - 0.5) * 2 * spread,
            y: rawAim.y + (Math.random() - 0.5) * 2 * spread,
          }
        : rawAim;

    let dx = aim.x - muzzle.x;
    let dy = aim.y - muzzle.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 4) return;

    const steps = Math.max(2, Math.ceil(dist / CONFIG.sampleStep));
    const env = { config: CONFIG, marks: state.marks, canvas: state.canvas };

    let hitTarget = null;
    let hitPoint = null;

    for (let i = 1; i <= steps && !hitTarget; i++) {
      const t = i / steps;
      const x = muzzle.x + dx * t;
      const y = muzzle.y + dy * t;

      let stack;
      try {
        stack = document.elementsFromPoint(x, y);
      } catch (e) {
        continue;
      }
      if (!stack) continue;

      for (const node of stack) {
        if (!node || node.nodeType !== 1) continue;
        if (node === state.canvas || node === document.documentElement || node === document.body) {
          continue;
        }
        if (node.hasAttribute && node.hasAttribute('data-adslash-ui')) continue;

        const target = findSlashTarget(node, env);
        if (target && !state.slashed.has(target) && !state.pending.has(target)) {
          hitTarget = target;
          hitPoint = { x, y };
        }
        break;
      }
    }

    const end = hitPoint || aim;

    // 弹道
    if (state.tracers.length > 40) state.tracers.shift();
    state.tracers.push({ x1: muzzle.x, y1: muzzle.y, x2: end.x, y2: end.y, alpha: 1 });

    sound.play('machinegunFire');
    state.shake = Math.max(state.shake, 0.22);

    // 机枪枪口火光：记录方向，绘制时按侧视画成锥形
    if (CONFIG.muzzleFlashEnabled !== false) {
      const len = Math.hypot(dx, dy) || 1;
      state.muzzleFlash = {
        x: muzzle.x,
        y: muzzle.y,
        dx: dx / len,
        dy: dy / len,
        until: now() + 70,
      };
    }

    if (hitTarget) {
      const radius = Number.isFinite(opts.holeRadius)
        ? opts.holeRadius
        : CONFIG.machinegunHoleRadius;
      holeDestroy(hitTarget, end.x, end.y, radius);
    } else {
      spawnSparks(
        state.particles,
        { left: end.x - 6, top: end.y - 6, width: 12, height: 12 },
        end,
        { x: dx, y: dy }
      );
    }
  }

  // 左轮：点一次打一枪，弹孔光滑并冒烟；打空后自动换弹
  function singleShotAt(x, y) {
    const t = now();
    if (t < state.reloadingUntil) return;
    if (t - state.lastFireAt < CONFIG.revolverCooldown) return;
    state.lastFireAt = t;

    let hit = null;
    try {
      const stack = document.elementsFromPoint(x, y) || [];
      for (const node of stack) {
        if (!node || node.nodeType !== 1) continue;
        if (node === state.canvas || node === document.documentElement || node === document.body) {
          continue;
        }
        if (node.hasAttribute && node.hasAttribute('data-adslash-ui')) continue;
        hit = node;
        break;
      }
    } catch (e) {}

    sound.play('revolverFire');
    state.shake = 0.6;
    state.shockwaves.push({ x, y, r: 10, alpha: 0.8 });

    // 抛壳
    if (CONFIG.shellCasingsEnabled !== false) {
      spawnShell(state.particles, x, y);
    }

    // 消耗一发；打空后进入换弹
    state.chambers = Math.max(0, state.chambers - 1);
    if (state.chambers === 0) {
      sound.play('reload');
      state.reloadingUntil = t + CONFIG.revolverReloadMs;
      setTimeout(() => {
        state.chambers = Math.max(1, Math.floor(CONFIG.revolverChambers) || 6);
        state.reloadingUntil = 0;
      }, CONFIG.revolverReloadMs);
    }

    const target = hit
      ? findSlashTarget(hit, { config: CONFIG, marks: state.marks, canvas: state.canvas })
      : null;

    if (!target) {
      spawnSparks(
        state.particles,
        { left: x - 6, top: y - 6, width: 12, height: 12 },
        { x, y },
        { x: 1, y: 0 }
      );
      return;
    }

    holeDestroy(target, x, y, CONFIG.revolverHoleRadius, { smooth: true, smoke: true });
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
      sound.play('bladeCut');

      state.slashCount++;
      onSlash({ el, rect, count: state.slashCount, weapon: CONFIG.weapon });
    } catch (e) {
      console.error(e);
      hideEl(el);
    }

    state.pending.delete(el);
  }

  // 炮/枪的摧毁：不做切线切分，直接在目标上挖洞
  function holeDestroy(el, cx, cy, holeRadius, options) {
    if (!el || state.pending.has(el) || state.slashed.has(el)) return;

    state.pending.add(el);
    const rect = el.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) {
      state.pending.delete(el);
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

      const hole = Math.min(holeRadius, Math.max(rect.width, rect.height) * 0.75);

      if (options && options.breakup) {
        // 炮：裂缝先不规则生长（带转折与分叉），长完再碎块崩开
        const started = spawnBlastCracks(el, rect, cx, cy, {
          holeRadius: hole,
          hitStop: CONFIG.hitStop,
          stepBase: Math.max(70, CONFIG.cutStepBase * 0.7),
          stepDecay: CONFIG.cutStepDecay,
          stepMin: CONFIG.cutStepMin,
          onCrack: () => sound.play('cannonCrack'),
          onDone: () => {
            const ok = spawnBlastBreakup(el, rect, cx, cy, {
              holeRadius: hole,
              hitStop: 0,
              stepBase: Math.max(50, CONFIG.cutStepBase * 0.5),
              stepDecay: CONFIG.cutStepDecay,
              stepMin: 30,
              onCrack: () => sound.play('cannonCrack'),
              onBurst: () => sound.play('cannonBreak'),
            });
            if (!ok) sound.play('cannonBreak');
          },
        });

        if (!started) {
          spawnBlastHole(el, rect, cx, cy, {
            holeRadius: hole,
            hitStop: CONFIG.hitStop,
            holdMs: CONFIG.blastHoleHold,
            crackWidth: CONFIG.crackWidth,
            crackLength: CONFIG.crackLength,
            crackStartWidth: CONFIG.crackStartWidth,
            crackEndWidth: CONFIG.crackEndWidth,
          });
          sound.play('cannonBreak');
        }
      } else {
        spawnBlastHole(el, rect, cx, cy, {
          holeRadius: hole,
          hitStop: CONFIG.hitStop,
          holdMs: CONFIG.blastHoleHold,
          crackWidth: CONFIG.crackWidth,
          crackLength: CONFIG.crackLength,
          crackStartWidth: CONFIG.crackStartWidth,
          crackEndWidth: CONFIG.crackEndWidth,
          smooth: !!(options && options.smooth),
        });
      }

      spawnSparks(state.particles, rect, { x: cx, y: cy }, { x: 1, y: 0 });

      if (options && options.smoke) {
        spawnSmoke(state.particles, cx, cy, holeRadius);
      }

      // 破坏音效与开火音效分离
      if (CONFIG.weapon === 'revolver') sound.play('revolverHit');
      else if (CONFIG.weapon === 'machinegun') sound.play('machinegunHit');

      state.slashCount++;
      onSlash({ el, rect, count: state.slashCount, blast: true, weapon: CONFIG.weapon });
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
    sound.play('bladeCut');

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

      sound.play('bladeBreak');
      state.shockwaves.push({
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        r: Math.max(rect.width, rect.height) * 0.18,
        alpha: 1,
      });

      const last = cuts[cuts.length - 1];
      spawnSparks(state.particles, rect, last.hitPoint, last.dir);

      state.slashCount++;
      onSlash({ el, rect, count: state.slashCount, cuts: cuts.length, weapon: CONFIG.weapon });
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

    const weapon = currentWeapon();

    // 按住类武器：以按下点为枪口，按住期间持续射击
    if (weapon && weapon.implemented && weapon.input === 'hold') {
      e.preventDefault();
      state.firing.active = true;
      state.firing.muzzle = { x: e.clientX, y: e.clientY };
      state.firing.aim = { x: e.clientX, y: e.clientY };
      state.firing.lastShotAt = 0;
      return;
    }

    // 点击类武器：按下即开火，不进入拖动流程
    if (weapon && weapon.implemented && weapon.input === 'click') {
      e.preventDefault();
      if (weapon.id === 'cannon') blastAt(e.clientX, e.clientY);
      else if (weapon.id === 'revolver') singleShotAt(e.clientX, e.clientY);
      return;
    }

    // 未实现的武器不响应输入
    if (!canSlash()) return;

    sound.play('bladeSwing');

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
    // 射击时瞄准点跟随光标，不受 isDrawing 限制
    if (state.firing.active) {
      state.firing.aim = { x: e.clientX, y: e.clientY };
    }

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

    state.firing.active = false;

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

    fireStep();

    drawTargetBoxes(ctx, state);
    drawEffects(ctx, state);
    drawTrail(ctx, state, CONFIG);
    updateParticles(ctx, state);
    drawFiringGuide(ctx, state);
    drawTracers(ctx, state);
    drawMuzzleFlash(ctx, state);
    drawChambers(ctx, state, CONFIG);
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
    state.firing.active = false;
    state.firing.muzzle = null;
    state.tracers = [];
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

  // 配置器预览：可单独播放声音 / 特效 / 滤镜，或触发一次真实攻击
  function preview(x, y, kind) {
    const weapon = currentWeapon();
    if (!weapon) return { ok: false, reason: 'no-weapon' };

    // 视口外的坐标拿不到命中元素
    if (kind !== 'sound' && (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight)) {
      return { ok: false, reason: 'out-of-view' };
    }

    if (kind === 'sound') {
      if (weapon.id === 'blade') sound.play('bladeSwing');
      else if (weapon.id === 'cannon') sound.play('cannonFire');
      else if (weapon.id === 'revolver') sound.play('revolverFire');
      else if (weapon.id === 'machinegun') sound.play('machinegunFire');
      else sound.play('bladeSwing');
      return { ok: true, weapon: weapon.id };
    }

    if (kind === 'filter') {
      let hit = null;
      try {
        const stack = document.elementsFromPoint(x, y) || [];
        for (const node of stack) {
          if (!node || node.nodeType !== 1) continue;
          if (node === state.canvas || node === document.documentElement || node === document.body) {
            continue;
          }
          if (node.hasAttribute && node.hasAttribute('data-adslash-ui')) continue;
          hit = node;
          break;
        }
      } catch (e) {}

      if (!hit) return { ok: false, reason: 'no-element' };

      const filter = weapon.hitFilter || 'brightness(2.4) contrast(1.5)';
      const prevFilter = hit.style.filter;
      const prevTransition = hit.style.transition;
      hit.style.transition = 'filter 0.18s ease-out';
      hit.style.filter = filter;
      setTimeout(() => {
        hit.style.filter = prevFilter || '';
        setTimeout(() => {
          hit.style.transition = prevTransition || '';
        }, 220);
      }, 90);
      return { ok: true, weapon: weapon.id };
    }

    if (!state.active) activate();

    if (kind === 'effect') {
      state.shockwaves.push({ x, y, r: 8, alpha: 1 });
      spawnSparks(
        state.particles,
        { left: x - 12, top: y - 12, width: 24, height: 24 },
        { x, y },
        { x: 1, y: 0 }
      );
      if (weapon.id === 'revolver') spawnSmoke(state.particles, x, y, CONFIG.revolverHoleRadius);
      return { ok: true, weapon: weapon.id };
    }

    if (kind === 'attack') {
      if (weapon.id === 'cannon') blastAt(x, y);
      else if (weapon.id === 'revolver') singleShotAt(x, y);
      else if (weapon.id === 'machinegun') {
        fireBullet(
          { x: Math.max(4, x - 160), y },
          { x, y },
          { holeRadius: CONFIG.machinegunHoleRadius, spread: 0 }
        );
      } else {
        let hit = null;
        try {
          const stack = document.elementsFromPoint(x, y) || [];
          for (const node of stack) {
            if (!node || node.nodeType !== 1) continue;
            if (node === state.canvas || node === document.documentElement) continue;
            if (node.hasAttribute && node.hasAttribute('data-adslash-ui')) continue;
            hit = node;
            break;
          }
        } catch (e) {}
        if (hit) slash(hit, { x, y }, { x: 1, y: 0 }, { x, y }, []);
      }
      return { ok: true, weapon: weapon.id };
    }

    return { ok: false, reason: 'unknown-kind' };
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
    // 武器框架
    getWeapons: () => WEAPONS,
    getWeapon: () => currentWeapon(),
    setWeapon,
    preview,
    // 调试/自检用：不参与游戏逻辑
    getDebugState: () => ({
      active: state.active,
      drawing: state.isDrawing,
      weapon: CONFIG.weapon,
      chambers: state.chambers,
      activeHits: state.activeHits.size,
      locked: state.lockedTargets.size,
      cuts: Array.from(state.lockedTargets.values()).map((r) => (r.cuts ? r.cuts.length : 0)),
    }),
    destroy,
  };
}
