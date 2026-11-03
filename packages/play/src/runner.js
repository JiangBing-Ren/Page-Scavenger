import { createCleaner } from '../../core/src/engine.js';
import {
  basePointsForArea,
  comboMultiplier,
  gradeFor,
  scoreForSlash,
  timeBonus,
} from '../../core/src/score.js';

const STORE_PREFIX = 'cleaner.best.';

const body = document.body;
const level = {
  id: body.dataset.levelId || 'level',
  time: Number(body.dataset.levelTime) || 60,
  par: Number(body.dataset.levelScore) || 300,
  next: body.dataset.next || '',
};

const thresholds = {
  s: Number(body.dataset.gradeS) || Math.round(level.par * 1.5),
  a: Number(body.dataset.gradeA) || Math.round(level.par * 1.15),
  b: Number(body.dataset.gradeB) || Math.round(level.par * 0.85),
};

const state = {
  score: 0,
  combo: 0,
  maxCombo: 0,
  hits: 0,
  decoys: 0,
  remaining: 0,
  total: 0,
  startedAt: 0,
  finished: false,
};

let hud = null;
let tickHandle = null;

const storage = {
  async loadMarks() {
    try {
      const raw = localStorage.getItem('cleaner.marks');
      const all = raw ? JSON.parse(raw) : {};
      const list = all[location.pathname];
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  },
  saveMarks(list) {
    try {
      const raw = localStorage.getItem('cleaner.marks');
      const all = raw ? JSON.parse(raw) : {};
      all[location.pathname] = list.slice(-100);
      localStorage.setItem('cleaner.marks', JSON.stringify(all));
    } catch (e) {}
  },
  clearMarks() {
    try {
      const raw = localStorage.getItem('cleaner.marks');
      const all = raw ? JSON.parse(raw) : {};
      delete all[location.pathname];
      localStorage.setItem('cleaner.marks', JSON.stringify(all));
    } catch (e) {}
  },
};

function readBest() {
  const raw = Number(localStorage.getItem(STORE_PREFIX + level.id));
  return Number.isFinite(raw) ? raw : 0;
}

function writeBest(value) {
  try {
    localStorage.setItem(STORE_PREFIX + level.id, String(value));
  } catch (e) {}
}

function injectStyles() {
  const style = document.createElement('style');
  style.textContent = `
    #cleaner-hud { position: fixed; left: 14px; top: 14px; z-index: 2147483648;
      display: flex; gap: 14px; align-items: center; padding: 9px 12px; border-radius: 10px;
      background: rgba(12,16,22,.9); border: 1px solid #2b3442; color: #e9eef6;
      font: 12px/1.3 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;
      pointer-events: none; }
    #cleaner-hud .k { color: #8593a5; margin-right: 4px; }
    #cleaner-hud .v { font-weight: 600; font-variant-numeric: tabular-nums; }
    #cleaner-hud .combo { color: #00ffcc; }
    #cleaner-hud .time.low { color: #ff6b6b; }
    #cleaner-hud button { pointer-events: auto; margin-left: 6px; padding: 4px 8px;
      font: inherit; font-size: 11px; color: #e9eef6; background: #1b2029;
      border: 1px solid #2b3442; border-radius: 6px; cursor: pointer; }
    #cleaner-hud button:hover { border-color: #00ffcc; color: #00ffcc; }
    #cleaner-result { position: fixed; inset: 0; z-index: 2147483649; display: grid;
      place-items: center; background: rgba(6,9,13,.74);
      font: 13px/1.6 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif; color: #e9eef6; }
    #cleaner-result .card { width: 330px; padding: 22px; border-radius: 14px;
      background: #121821; border: 1px solid #2b3442; text-align: center;
      box-shadow: 0 24px 60px rgba(0,0,0,.5); }
    #cleaner-result .grade { font-size: 46px; font-weight: 700; letter-spacing: 2px; color: #00ffcc; }
    #cleaner-result h2 { margin: 0 0 4px; font-size: 16px; }
    #cleaner-result .rows { display: grid; gap: 4px; margin: 14px 0 18px;
      font-size: 12.5px; color: #8593a5; }
    #cleaner-result .rows b { color: #e9eef6; }
    #cleaner-result .btns { display: flex; gap: 8px; }
    #cleaner-result button, #cleaner-result a { flex: 1; padding: 8px; border-radius: 8px;
      border: 1px solid #2b3442; background: #171d26; color: #e9eef6; font: inherit;
      text-align: center; text-decoration: none; cursor: pointer; }
    #cleaner-result button:hover, #cleaner-result a:hover { border-color: #00ffcc; color: #00ffcc; }
    [data-decoy-hit] { outline: 2px dashed #ff6b6b; outline-offset: -4px; }
  `;
  document.head.appendChild(style);
}

function buildHud() {
  const el = document.createElement('div');
  el.id = 'cleaner-hud';
  el.setAttribute('data-adslash-ui', '1');
  el.innerHTML = `
    <span><span class="k">分数</span><span class="v" data-k="score">0</span></span>
    <span><span class="k">连击</span><span class="v combo" data-k="combo">×1.00</span></span>
    <span><span class="k">剩余</span><span class="v" data-k="remain">0</span></span>
    <span><span class="k">时间</span><span class="v time" data-k="time">--</span></span>
    <button type="button" data-act="toggle">暂停斩击</button>
  `;
  document.body.appendChild(el);
  return el;
}

function updateHud() {
  if (!hud) return;
  hud.querySelector('[data-k="score"]').textContent = String(state.score);
  hud.querySelector('[data-k="combo"]').textContent =
    '×' + comboMultiplier(state.combo).toFixed(2);
  hud.querySelector('[data-k="remain"]').textContent = String(state.remaining);
}

function leftSeconds() {
  if (!state.startedAt) return level.time;
  return Math.max(0, level.time - (Date.now() - state.startedAt) / 1000);
}

function tick() {
  if (state.finished || !hud) return;
  const left = leftSeconds();
  const timeEl = hud.querySelector('[data-k="time"]');
  timeEl.textContent = left.toFixed(1) + 's';
  timeEl.classList.toggle('low', left <= 10);
  if (left <= 0) finish('timeup');
}

function startTimer() {
  if (state.startedAt || state.finished) return;
  state.startedAt = Date.now();
  tickHandle = setInterval(tick, 100);
  tick();
}

// 碎片克隆会连同 data-target 一起复制，必须排除 UI 层内的副本
function aliveTargets() {
  return Array.from(document.querySelectorAll('[data-target]:not([data-scored])')).filter(
    (el) => !el.closest('[data-adslash-ui]')
  );
}

// 被切元素本身 + 其后代里的目标 / 禁区
function collect(el) {
  const targets = [];
  const decoys = [];

  if (el.matches && el.matches('[data-target]') && !el.hasAttribute('data-scored')) {
    targets.push(el);
  }
  el.querySelectorAll('[data-target]:not([data-scored])').forEach((node) => targets.push(node));

  if (el.matches && el.matches('[data-decoy]')) decoys.push(el);
  el.querySelectorAll('[data-decoy]').forEach((node) => decoys.push(node));

  return { targets, decoys };
}

function pointsOf(el) {
  const declared = Number(el.dataset.points);
  if (Number.isFinite(declared) && declared > 0) return declared;
  const rect = el.getBoundingClientRect();
  return basePointsForArea(rect.width * rect.height);
}

function handleSlash({ el, piece }) {
  // 连切碎片不计入关卡目标，避免误断连击
  if (piece) return;
  if (state.finished || !el) return;
  startTimer();

  const { targets, decoys } = collect(el);

  if (!targets.length && !decoys.length) {
    state.combo = 0;
    updateHud();
    return;
  }

  const points = [];
  for (const target of targets) {
    target.setAttribute('data-scored', '');
    points.push(pointsOf(target));
    state.hits++;
  }

  if (targets.length) {
    state.combo++;
    state.maxCombo = Math.max(state.maxCombo, state.combo);
  } else {
    state.combo = 0;
  }

  if (decoys.length) {
    state.decoys += decoys.length;
    state.combo = 0;
    for (const decoy of decoys) decoy.setAttribute('data-decoy-hit', '');
  }

  const result = scoreForSlash(points, state.combo || 1, decoys.length);
  state.score = Math.max(0, state.score + result.total);
  state.remaining = aliveTargets().length;

  updateHud();

  if (state.remaining === 0) finish('clear');
}

function finish(reason) {
  if (state.finished) return;
  state.finished = true;

  if (tickHandle) clearInterval(tickHandle);
  cleaner.deactivate();

  const bonus = reason === 'clear' ? timeBonus(leftSeconds()) : 0;
  state.score += bonus;

  const grade = gradeFor(state.score, thresholds);
  const best = Math.max(readBest(), state.score);
  writeBest(best);

  showResult({ reason, bonus, grade, best });
}

function showResult({ reason, bonus, grade, best }) {
  const overlay = document.createElement('div');
  overlay.id = 'cleaner-result';
  overlay.setAttribute('data-adslash-ui', '1');

  const cleared = reason === 'clear';
  overlay.innerHTML = `
    <div class="card">
      <div class="grade">${grade}</div>
      <h2>${cleared ? '清理完毕' : '时间到'}</h2>
      <div class="rows">
        <div>得分 <b>${state.score}</b>${bonus ? `（含时间奖励 ${bonus}）` : ''}</div>
        <div>命中 <b>${state.hits}</b> / ${state.total}　误伤 <b>${state.decoys}</b></div>
        <div>最大连击 <b>×${comboMultiplier(state.maxCombo).toFixed(2)}</b>（${state.maxCombo} 连）</div>
        <div>最佳记录 <b>${best}</b></div>
      </div>
      <div class="btns">
        <button type="button" data-act="retry">重玩</button>
        ${level.next ? `<a href="${level.next}">下一关</a>` : ''}
        <a href="index.html">关卡列表</a>
      </div>
    </div>
  `;

  overlay.querySelector('[data-act="retry"]').addEventListener('click', () => location.reload());
  document.body.appendChild(overlay);
}

const cleaner = createCleaner({
  storage,
  config: { targetSelector: '[data-target],[data-decoy]' },
  onSlash: handleSlash,
});

injectStyles();
hud = buildHud();

state.total = aliveTargets().length;
state.remaining = state.total;
updateHud();

hud.querySelector('[data-act="toggle"]').addEventListener('click', () => {
  if (state.finished) return;
  if (cleaner.isActive()) cleaner.deactivate();
  else cleaner.activate();
});

cleaner.activate();
