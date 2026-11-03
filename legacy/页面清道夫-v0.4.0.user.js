// ==UserScript==
// @name         页面清道夫 - Ad Slash
// @namespace    https://example.local/adslash
// @version      0.4.0
// @description  以「斩击」方式切除网页中的广告与杂乱元素：按住左键划过目标，刀光、切线、分离、碎片一气呵成。
// @match        *://*/*
// @grant        none
// @run-at       document-start
// @noframes
// ==/UserScript==
(function () {
  'use strict';
  console.log("⚔️ Ad Slash (可调顿感版) 已启动！");

  const CONFIG = {
    trailLength: 25, 
    trailLifeMs: 160, 
    sampleStep: 4, 
    hideProp: 'visibility', hideValue: 'hidden',
    autoApplyMarks: true, maxAncestorDepth: 15, maxTargetRatio: 0.85, 
    pierceRatio: 0.6, 
    executeOnRelease: false, 
    hitStop: 40, // 🌟 默认顿感：40ms
  };

  const BASE_SELECTORS = [
    'ins.adsbygoogle', 'iframe[src*="doubleclick.net"]', 'iframe[src*="googlesyndication.com"]',
    'iframe[src*="adservice.google"]', 'iframe[id^="google_ads_iframe"]', 'iframe[id^="aswift"]',
    '[id^="div-gpt-ad"]', '[data-ad-slot]', '[data-ad-client]'
  ];

  const SKIP_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'OPTION']);
  const STORE_KEY = 'adslash.marks.v1';

  const state = {
    active: false, forceMode: false, isDrawing: false, 
    targetSizeLevel: 'auto', 
    activeHits: new Map(), 
    lockedTargets: new Map(), 
    flashes: [], 
    particles: [], 
    canvas: null, ctx: null, dpr: 1, cssW: 0, cssH: 0,
    trail: [], prevPoint: null, rafId: null, observer: null,
    slashed: new WeakSet(), pending: new Set(), undoStack: [], closeBtn: null, listeners: [],
  };

  const now = () => performance.now();

  function loadAllMarks() { try { const data = localStorage.getItem(STORE_KEY); return data ? JSON.parse(data) : {}; } catch (e) { return {}; } }
  function saveAllMarks(all) { try { localStorage.setItem(STORE_KEY, JSON.stringify(all)); } catch (e) {} }
  function getMarksForHost() { return loadAllMarks()[location.hostname] || []; }
  function addMark(sel) {
    if (!sel) return;
    const all = loadAllMarks(); const list = all[location.hostname] || [];
    if (!list.includes(sel)) { list.push(sel); all[location.hostname] = list.slice(-200); saveAllMarks(all); }
  }
  function removeMark(sel) {
    const all = loadAllMarks(); const list = all[location.hostname] || [];
    const idx = list.indexOf(sel); if (idx >= 0) { list.splice(idx, 1); all[location.hostname] = list; saveAllMarks(all); }
  }
  function clearMarks() { const all = loadAllMarks(); delete all[location.hostname]; saveAllMarks(all); }

  function cssPath(el) {
    if (!el || el.nodeType !== 1) return '';
    if (el.id) { try { return '#' + CSS.escape(el.id); } catch (e) { return '#' + el.id; } }
    const parts = []; let cur = el; let guard = 0;
    while (cur && cur.nodeType === 1 && cur !== document.documentElement && guard++ < 12) {
      let sel = cur.localName; const parent = cur.parentElement;
      if (parent) {
        const currentTag = cur.localName;
        const sameTag = Array.from(parent.children).filter((c) => c.localName === currentTag);
        if (sameTag.length > 1) sel += ':nth-of-type(' + (sameTag.indexOf(cur) + 1) + ')';
      }
      parts.unshift(sel);
      if (cur.id) { try { parts[0] = '#' + CSS.escape(cur.id); } catch (e) { parts[0] = '#' + cur.id; } break; }
      cur = parent;
    }
    return parts.join(' > ');
  }

  function safeMatches(el, sel) { try { return el.matches(sel); } catch (e) { return false; } }
  const markCache = { host: '', list: [] };
  function currentMarks() {
    if (markCache.host !== location.hostname) { markCache.host = location.hostname; markCache.list = getMarksForHost(); }
    return markCache.list;
  }

  function isTarget(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el === document.body || el === document.documentElement) return false;
    if (state.canvas && el === state.canvas) return false;
    if (el.hasAttribute && el.hasAttribute('data-adslash-ui')) return false;
    if (SKIP_TAGS.has(el.tagName)) return false;
    if (el.isContentEditable) return false;

    if (state.forceMode) return true; 

    for (const sel of BASE_SELECTORS) { if (safeMatches(el, sel)) return true; }
    for (const sel of currentMarks()) { if (safeMatches(el, sel)) return true; }
    return false;
  }

  function findSlashTarget(el) {
    let cur = el; 
    let depth = 0;
    
    let minArea = 2500; 
    let limitW = window.innerWidth * CONFIG.maxTargetRatio; 
    let limitH = window.innerHeight * CONFIG.maxTargetRatio;
    
    let isAuto = state.targetSizeLevel === 'auto';

    if (state.targetSizeLevel === 'small') {
        minArea = 50;
    } else if (state.targetSizeLevel === 'medium') {
        minArea = 10000;
    } else if (state.targetSizeLevel === 'large') {
        minArea = 40000;
    } else if (state.targetSizeLevel === 'auto') {
        limitW = window.innerWidth * 0.45;
        limitH = window.innerHeight * 0.45;
        minArea = 2000; 
    } else if (state.targetSizeLevel === 'balance') {
        minArea = 2500;
    }

    let best = null;
    
    while (cur && cur !== document.body && cur !== document.documentElement && depth < CONFIG.maxAncestorDepth) {
      if (isTarget(cur)) {
        const r = cur.getBoundingClientRect();
        const area = r.width * r.height;
        
        if (r.width > 2 && r.height > 2 && area >= minArea) {
          if (r.width > limitW || r.height > limitH) {
            break;
          }
          
          const cs = window.getComputedStyle(cur);
          if (!(cs.display === 'inline' && !cs.backgroundImage && cs.backgroundColor === 'rgba(0, 0, 0, 0)')) {
            if (isAuto) {
              best = cur; 
            } else {
              return cur;
            }
          }
        }
      }
      cur = cur.parentElement; 
      depth++;
    }
    return best;
  }

  function hideEl(el) { try { el.style.setProperty(CONFIG.hideProp, CONFIG.hideValue, 'important'); } catch (e) {} }
  function restoreEl(el, prevStyle) { try { if (prevStyle == null) el.removeAttribute('style'); else el.setAttribute('style', prevStyle); } catch (e) {} }

  function getSplitPolygons(w, h, a, dx, dy) {
    const corners = [
      { x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }
    ];
    const polyA = [], polyB = [];
    for (let i = 0; i < 4; i++) {
      const p1 = corners[i];
      const p2 = corners[(i + 1) % 4];
      const f1 = dx * (p1.y - a.y) - dy * (p1.x - a.x);
      const f2 = dx * (p2.y - a.y) - dy * (p2.x - a.x);
      
      if (f1 >= 0) polyA.push(p1);
      else polyB.push(p1);
      
      if ((f1 > 0 && f2 < 0) || (f1 < 0 && f2 > 0)) {
        const t = f1 / (f1 - f2);
        const ip = { x: p1.x + (p2.x - p1.x) * t, y: p1.y + (p2.y - p1.y) * t };
        polyA.push(ip);
        polyB.push(ip);
      }
    }
    return { polyA, polyB };
  }

  function spawnSparks(rect, hitPoint, dir) {
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

      state.particles.push({
        x: cx, y: cy,
        vx: nx * side * vSpeed + (Math.random() - 0.5) * 10,
        vy: ny * side * vSpeed + (Math.random() - 0.5) * 10 - 5, 
        size: Math.random() * 3 + 1,
        color: Math.random() > 0.8 ? '#ffffff' : (Math.random() > 0.5 ? '#00ffcc' : '#ffcc00'),
        life: 1,
        decay: Math.random() * 0.03 + 0.015,
        isChunk: false
      });
    }

    const chunkCount = 10;
    for (let i = 0; i < chunkCount; i++) {
        const side = Math.random() > 0.5 ? 1 : -1;
        state.particles.push({
          x: hitPoint.x + (Math.random()-0.5)*rect.width,
          y: hitPoint.y + (Math.random()-0.5)*rect.height,
          vx: nx * side * (Math.random()*10+5),
          vy: Math.random() * 10 - 5,
          size: Math.random() * 8 + 4,
          color: Math.random() > 0.5 ? 'rgba(200,200,200,0.8)' : 'rgba(150,200,255,0.8)',
          life: 1,
          decay: Math.random() * 0.01 + 0.005,
          isChunk: true
        });
    }
  }

  function spawnDOMFragments(el, rect, hitPoint, dir, entryPoint) {
    const w = rect.width;
    const h = rect.height;

    if (!entryPoint) return;

    let dx = dir.x, dy = dir.y;
    const len = Math.hypot(dx, dy);
    if (len < 0.001) { dx = 1; dy = 0; } else { dx /= len; dy /= len; }

    const ax = entryPoint.x - rect.left;
    const ay = entryPoint.y - rect.top;
    const a = { x: ax, y: ay };

    const { polyA, polyB } = getSplitPolygons(w, h, a, dx, dy);
    if (polyA.length < 3 || polyB.length < 3) return;

    const pStrA = polyA.map(p => `${p.x.toFixed(1)}px ${p.y.toFixed(1)}px`).join(',');
    const pStrB = polyB.map(p => `${p.x.toFixed(1)}px ${p.y.toFixed(1)}px`).join(',');

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
      willChange: 'transform, opacity'
    };

    const filterStr = 'brightness(2.5) contrast(1.5)';

    const cloneA = el.cloneNode(true);
    cloneA.querySelectorAll('iframe, video, audio, script').forEach(n => n.remove());
    cloneA.removeAttribute('id');
    Object.assign(cloneA.style, baseStyle, { 
      clipPath: `polygon(${pStrA})`, 
      filter: filterStr 
    });
    cloneA.style.setProperty('visibility', 'visible', 'important');
    document.body.appendChild(cloneA);

    const cloneB = el.cloneNode(true);
    cloneB.querySelectorAll('iframe, video, audio, script').forEach(n => n.remove());
    cloneB.removeAttribute('id');
    Object.assign(cloneB.style, baseStyle, { 
      clipPath: `polygon(${pStrB})`, 
      filter: filterStr 
    });
    cloneB.style.setProperty('visibility', 'visible', 'important');
    document.body.appendChild(cloneB);

    const nx = -dy, ny = dx;
    const speedX = 150 + Math.min(200, len * 3); 
    const rotA = (Math.random() - 0.5) * 90;
    const rotB = (Math.random() - 0.5) * 90;

    // 🌟 顿感延迟：使用配置的 hitStop
    setTimeout(() => {
      const trans = 'transform 1.2s cubic-bezier(0.3, 0.1, 0.6, 1), opacity 0.6s ease-in 0.6s, filter 0.2s';
      
      Object.assign(cloneA.style, {
        transition: trans,
        transform: `translate3d(${nx * speedX}px, 600px, 0) rotate3d(1, 1, 0, ${rotA}deg)`,
        opacity: '0',
        filter: 'none'
      });

      Object.assign(cloneB.style, {
        transition: trans,
        transform: `translate3d(${-nx * speedX}px, 600px, 0) rotate3d(1, -1, 0, ${rotB}deg)`,
        opacity: '0',
        filter: 'none'
      });

      setTimeout(() => {
        if (cloneA.parentNode) cloneA.parentNode.removeChild(cloneA);
        if (cloneB.parentNode) cloneB.parentNode.removeChild(cloneB);
      }, 1500);
    }, CONFIG.hitStop); 
  }

  async function slash(el, hitPoint, dir, entryPoint, flashTrail) {
    if (!el || state.pending.has(el) || state.slashed.has(el)) return;
    state.pending.add(el); const rect = el.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) { state.pending.delete(el); return; }

    if (flashTrail && flashTrail.length > 1) {
      state.flashes.push({
        trail: flashTrail,
        hitPoint: hitPoint,
        alpha: 1, 
        fade: 0.06
      });
    }

    const sel = cssPath(el); const prevStyle = el.getAttribute('style'); const record = { sel, prevStyle };
    
    // 🌟 核心修改：彻底去掉原本的 150ms 延迟，瞬间隐藏并生成碎片
    try { 
      hideEl(el); 
      state.slashed.add(el);
      if (sel) { addMark(sel); markCache.host = ''; }
      state.undoStack.push(record); if (state.undoStack.length > 20) state.undoStack.shift();

      spawnDOMFragments(el, rect, hitPoint, dir, entryPoint); 
      spawnSparks(rect, hitPoint, dir); 
    } catch (e) { 
      console.error(e); 
      hideEl(el); 
    }
    
    state.pending.delete(el);
  }

  function checkHits(x, y) {
    for (const [el, entry] of state.activeHits.entries()) {
      if (state.lockedTargets.has(el)) { state.activeHits.delete(el); continue; }
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
            state.lockedTargets.set(el, { entry: { x: entry.x, y: entry.y }, hitPoint, dir, flashTrail });
          } else {
            slash(el, hitPoint, dir, { x: entry.x, y: entry.y }, flashTrail);
          }
        }
        state.activeHits.delete(el); 
      }
    }

    let stack; try { stack = document.elementsFromPoint(x, y); } catch (e) { return; }
    if (!stack || !stack.length) return;
    
    let hit = null;
    for (const n of stack) {
      if (!n || n.nodeType !== 1) continue;
      if (n === state.canvas || n === document.documentElement || n === document.body) continue;
      if (n.hasAttribute && n.hasAttribute('data-adslash-ui')) continue;
      hit = n; break;
    }
    if (!hit) return;
    
    const target = findSlashTarget(hit);
    if (!target || state.pending.has(target) || state.slashed.has(target) || state.activeHits.has(target) || state.lockedTargets.has(target)) return;
    state.activeHits.set(target, { x, y });
  }

  function onPointerDown(e) {
    if (!state.active) return;
    const btn = state.closeBtn;
    if (btn && e.clientX >= btn.x && e.clientX <= btn.x + btn.w && e.clientY >= btn.y && e.clientY <= btn.y + btn.h) {
      e.preventDefault(); e.stopPropagation(); deactivate(); return;
    }
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault(); 
    
    state.isDrawing = true;
    state.activeHits.clear(); 
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
      const a = state.prevPoint, b = pt; 
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      if (dist > 1) {
        const steps = Math.max(1, Math.ceil(dist / CONFIG.sampleStep));
        for (let i = 1; i <= steps; i++) { 
          const t = i / steps; 
          checkHits(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t); 
        }
      }
    }
    state.prevPoint = pt; state.trail.push(pt);
    if (state.trail.length > CONFIG.trailLength) state.trail.shift();
  }

  function onPointerUp(e) {
    if (!state.active) return;
    state.isDrawing = false;
    state.prevPoint = null; 
    state.activeHits.clear(); 
    
    if (CONFIG.executeOnRelease && state.lockedTargets.size > 0) {
      const targets = Array.from(state.lockedTargets.entries());
      state.lockedTargets.clear();
      
      let delay = 0;
      for (let i = 0; i < targets.length; i++) {
        const [el, data] = targets[i];
        setTimeout(() => { slash(el, data.hitPoint, data.dir, data.entry, data.flashTrail); }, delay);
        delay += Math.max(50, 150 / (i + 1)); 
      }
    }
  }

  function onWheel(e) { if (state.active) e.preventDefault(); }
  function onKeyDown(e) { if (state.active && e.key === 'Escape') { e.preventDefault(); deactivate(); } }

  function renderMultiLayerTrail(ctx, points, maxWidth, alpha) {
    if (!points || points.length < 2) return;
    
    const len = points.length;
    const leftPts = [];
    const rightPts = [];
    
    for (let i = 0; i < len; i++) {
      const p = points[i];
      let nx = 0, ny = 0;
      
      let dx = 0, dy = 0;
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
    for(let i=1; i<len; i++) {
      const ix = leftPts[i].x * 0.4 + tip.x * 0.6;
      const iy = leftPts[i].y * 0.4 + tip.y * 0.6;
      ctx.lineTo(ix, iy);
    }
    ctx.lineTo(tip.x, tip.y);
    for(let i=len-1; i>=0; i--) {
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

  function drawEffects(ctx) {
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
          ctx.arc(f.hitPoint.x, f.hitPoint.y, 6 * f.alpha, 0, Math.PI*2);
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
      
      for (const [el, data] of state.lockedTargets.entries()) {
        const dx = data.hitPoint.x - data.entry.x;
        const dy = data.hitPoint.y - data.entry.y;
        const len = Math.hypot(dx, dy);
        let ex = 0, ey = 0;
        if (len > 0) { ex = (dx / len) * 20; ey = (dy / len) * 20; }

        ctx.beginPath();
        ctx.moveTo(data.entry.x - ex, data.entry.y - ey);
        ctx.lineTo(data.hitPoint.x + ex, data.hitPoint.y + ey);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  function drawTargetBoxes(ctx) {
    if (!state.isDrawing && state.lockedTargets.size === 0) return;

    const drawBox = (rect, color) => {
      ctx.fillStyle = color === '#00ffcc' ? 'rgba(120, 200, 255, 0.08)' : 'rgba(255, 100, 100, 0.05)';
      ctx.fillRect(rect.left, rect.top, rect.width, rect.height);

      const cornerLen = Math.min(20, rect.width / 3, rect.height / 3); 
      ctx.strokeStyle = color; 
      ctx.lineWidth = 2; ctx.lineCap = 'round';
      
      ctx.beginPath();
      ctx.moveTo(rect.left, rect.top + cornerLen); ctx.lineTo(rect.left, rect.top); ctx.lineTo(rect.left + cornerLen, rect.top);
      ctx.moveTo(rect.right - cornerLen, rect.top); ctx.lineTo(rect.right, rect.top); ctx.lineTo(rect.right, rect.top + cornerLen);
      ctx.moveTo(rect.right, rect.bottom - cornerLen); ctx.lineTo(rect.right, rect.bottom); ctx.lineTo(rect.right - cornerLen, rect.bottom);
      ctx.moveTo(rect.left + cornerLen, rect.bottom); ctx.lineTo(rect.left, rect.bottom); ctx.lineTo(rect.left, rect.bottom - cornerLen);
      ctx.stroke();
    };

    if (state.isDrawing) {
      for (const [el, entry] of state.activeHits.entries()) {
        drawBox(el.getBoundingClientRect(), '#00ffcc');
      }
    }
    for (const [el, data] of state.lockedTargets.entries()) {
      drawBox(el.getBoundingClientRect(), '#ff6464');
    }
  }

  function drawTrail(ctx) {
    const t = state.trail; 
    if (t.length < 2) return;
    const tNow = now(); 
    const validPts = [];
    for (let i = 0; i < t.length; i++) {
      if (tNow - t[i].t <= CONFIG.trailLifeMs) validPts.push(t[i]);
    }
    if (validPts.length < 2) return;

    ctx.save();
    const life = 1 - (tNow - t[0].t) / CONFIG.trailLifeMs;
    renderMultiLayerTrail(ctx, validPts, 14, Math.max(0, life));
    ctx.restore();
  }

  function updateParticles(ctx) {
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
        ctx.fillRect(-p.size/2, -p.size/2, p.size, p.size);
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  function drawCloseButton(ctx) {
    const size = 36, pad = 16; const x = window.innerWidth - size - pad, y = pad;
    state.closeBtn = { x, y, w: size, h: size };
    ctx.save(); ctx.globalAlpha = 0.88; ctx.fillStyle = 'rgba(18,20,26,0.92)';
    ctx.beginPath(); ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2; ctx.beginPath();
    ctx.moveTo(x + size * 0.32, y + size * 0.32); ctx.lineTo(x + size * 0.68, y + size * 0.68);
    ctx.moveTo(x + size * 0.68, y + size * 0.32); ctx.lineTo(x + size * 0.32, y + size * 0.68);
    ctx.stroke(); ctx.restore();
  }

  function loop() {
    if (!state.active || !state.ctx) { state.rafId = null; return; }
    const ctx = state.ctx; ctx.clearRect(0, 0, state.cssW, state.cssH);
    const tNow = now();
    if (!state.isDrawing) {
      while (state.trail.length && tNow - state.trail[0].t > CONFIG.trailLifeMs + 40) state.trail.shift();
    }
    
    drawTargetBoxes(ctx); 
    drawEffects(ctx); 
    drawTrail(ctx); 
    updateParticles(ctx); 
    drawCloseButton(ctx);
    
    state.rafId = requestAnimationFrame(loop);
  }

  function resizeCanvas() {
    const c = state.canvas; if (!c) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth, h = window.innerHeight;
    c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    c.style.width = w + 'px'; c.style.height = h + 'px';
    const ctx = c.getContext('2d'); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.scale(dpr, dpr);
    state.dpr = dpr; state.cssW = w; state.cssH = h; state.ctx = ctx;
  }

  function createCanvas() {
    const c = document.createElement('canvas'); c.dataset.adslashUi = '1';
    Object.assign(c.style, { position: 'fixed', left: '0', top: '0', zIndex: '2147483647', pointerEvents: 'auto', cursor: 'crosshair', touchAction: 'none', background: 'transparent', display: 'block' });
    document.documentElement.appendChild(c); state.canvas = c; resizeCanvas();
    const bind = (target, type, fn, opts) => { target.addEventListener(type, fn, opts); state.listeners.push({ target, type, fn, opts }); };
    bind(c, 'pointermove', onPointerMove, { passive: true }); bind(c, 'pointerdown', onPointerDown, { passive: false });
    bind(c, 'pointerup', onPointerUp, { passive: true }); bind(c, 'pointercancel', onPointerUp, { passive: true });
    bind(c, 'wheel', onWheel, { passive: false }); bind(window, 'resize', resizeCanvas, { passive: true }); bind(window, 'keydown', onKeyDown, { passive: false });
  }

  function destroyCanvas() {
    if (state.rafId) { cancelAnimationFrame(state.rafId); state.rafId = null; }
    for (const l of state.listeners) l.target.removeEventListener(l.type, l.fn, l.opts);
    state.listeners = [];
    if (state.canvas && state.canvas.parentNode) state.canvas.parentNode.removeChild(state.canvas);
    state.canvas = null; state.ctx = null; state.trail = []; state.flashes = []; state.particles = []; state.prevPoint = null; state.closeBtn = null;
  }

  function applyMarks() {
    const marks = getMarksForHost(); if (!marks.length) return;
    for (const sel of marks) {
      let nodes; try { nodes = document.querySelectorAll(sel); } catch (e) { continue; }
      for (const el of nodes) {
        if (state.slashed.has(el) || SKIP_TAGS.has(el.tagName)) continue;
        hideEl(el); state.slashed.add(el);
      }
    }
  }

  function startObserver() {
    if (state.observer || !document.body) return;
    let timer = null;
    const obs = new MutationObserver(() => {
      if (timer) return; timer = setTimeout(() => { timer = null; if (state.active) applyMarks(); }, 120);
    });
    obs.observe(document.body, { childList: true, subtree: true }); state.observer = obs;
  }
  function stopObserver() { if (state.observer) { state.observer.disconnect(); state.observer = null; } }

  function activate() {
    if (state.active) return; state.active = true; createCanvas(); startObserver();
    if (!state.rafId) state.rafId = requestAnimationFrame(loop);
    const btn = document.getElementById('adslash-fab');
    if (btn) { btn.innerText = '⏹ 退出斩击'; btn.style.background = '#4CAF50'; }
  }

  function deactivate() {
    if (!state.active) return; state.active = false; stopObserver(); destroyCanvas();
    const btn = document.getElementById('adslash-fab');
    if (btn) { btn.innerText = '⚔️ 开启斩击'; btn.style.background = '#1e1e1e'; }
  }

  function undoLast() {
    const rec = state.undoStack.pop(); if (!rec) return alert('没有可撤销的记录了');
    removeMark(rec.sel); markCache.host = '';
    let el = null; try { el = document.querySelector(rec.sel); } catch (e) { el = null; }
    if (el) { restoreEl(el, rec.prevStyle); state.slashed.delete(el); }
  }

  function clearHostMarks() { clearMarks(); markCache.host = ''; alert('已清空该网站的拦截记录，刷新后恢复。'); }

  function injectUI() {
    if (document.getElementById('adslash-fab') || !document.body) return;
    const btn = document.createElement('button'); btn.id = 'adslash-fab'; btn.dataset.adslashUi = '1'; btn.innerText = '⚔️ 开启斩击';
    Object.assign(btn.style, { position: 'fixed', right: '20px', bottom: '20px', zIndex: '2147483648', padding: '10px 16px', background: '#1e1e1e', color: '#fff', border: '2px solid #4CAF50', borderRadius: '8px', cursor: 'pointer', fontSize: '14px', fontWeight: 'bold', boxShadow: '0 4px 12px rgba(0,0,0,0.3)', transition: 'all 0.2s', display: 'block' });
    btn.onclick = (e) => { e.stopPropagation(); if (state.active) deactivate(); else activate(); };
    document.body.appendChild(btn);

    window.addEventListener('contextmenu', (e) => {
      if (!state.active && !e.altKey) return; e.preventDefault(); e.stopPropagation();
      let menu = document.getElementById('adslash-menu');
      if (!menu) {
        menu = document.createElement('div'); menu.id = 'adslash-menu'; menu.dataset.adslashUi = '1';
        Object.assign(menu.style, { position: 'fixed', zIndex: '2147483648', background: '#1e1e1e', color: '#fff', border: '1px solid #444', borderRadius: '6px', padding: '6px 0', boxShadow: '0 4px 12px rgba(0,0,0,0.5)', fontSize: '13px', display: 'none', minWidth: '240px', fontFamily: 'sans-serif', userSelect: 'none' });
        document.body.appendChild(menu);
      }
      menu.innerHTML = '';
      const addItem = (text, onClick) => {
        const item = document.createElement('div'); item.innerText = text;
        Object.assign(item.style, { padding: '8px 16px', cursor: 'pointer', transition: 'background 0.1s' });
        item.onmouseenter = () => item.style.background = '#333'; item.onmouseleave = () => item.style.background = 'transparent';
        item.onclick = () => { onClick(); menu.style.display = 'none'; }; menu.appendChild(item);
      };
      
      addItem(state.active ? '⏹ 退出斩击模式' : '⚔️ 开启斩击模式', () => { state.active ? deactivate() : activate(); });
      addItem(state.forceMode ? '🎯 自由切割：开启' : '🎯 自由切割：关闭', () => { state.forceMode = !state.forceMode; });
      
      const sizeLevels = ['auto', 'balance', 'large', 'medium', 'small'];
      const sizeLabels = { auto: '自动智能(抓大)', balance: '平衡', large: '大', medium: '中', small: '小' };
      
      addItem(`📐 尺寸挡位：${sizeLabels[state.targetSizeLevel]}`, () => {
        let idx = sizeLevels.indexOf(state.targetSizeLevel);
        idx = (idx + 1) % sizeLevels.length;
        state.targetSizeLevel = sizeLevels[idx];
      });

      // 🌟 新增：顿感设置
      const hitStops = [0, 20, 40, 80, 120];
      const hitStopLabels = { 0: '无', 20: '极短', 40: '短', 80: '中', 120: '长' };
      addItem(`💥 顿感强度：${hitStopLabels[CONFIG.hitStop]}`, () => {
        let idx = hitStops.indexOf(CONFIG.hitStop);
        idx = (idx + 1) % hitStops.length;
        CONFIG.hitStop = hitStops[idx];
      });

      addItem(CONFIG.executeOnRelease ? '⏳ 松手再切除：开启 (预锁定)' : '⚡ 松手再切除：关闭 (即切)', () => { CONFIG.executeOnRelease = !CONFIG.executeOnRelease; });

      addItem('↩️ 撤销上一次切除', undoLast); addItem('🧹 清空本域名记录', clearHostMarks); addItem('❌ 关闭菜单', () => {});
      menu.style.left = e.clientX + 'px'; menu.style.top = e.clientY + 'px'; menu.style.display = 'block';
    }, true);

    window.addEventListener('pointerdown', (e) => {
      const menu = document.getElementById('adslash-menu'); if (menu && !menu.contains(e.target)) menu.style.display = 'none';
    }, true);
  }

  function boot() {
    injectUI();
    if (CONFIG.autoApplyMarks) {
      try {
        applyMarks(); let pending = null;
        const obs = new MutationObserver(() => {
          if (pending) return; pending = setTimeout(() => { pending = null; applyMarks(); }, 300);
        });
        if (document.body) { obs.observe(document.body, { childList: true, subtree: true }); setTimeout(() => obs.disconnect(), 15000); }
      } catch (e) {}
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
