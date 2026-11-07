import { basePointsForArea, comboMultiplier, scoreForSlash } from './score.js';
import { getWeapon } from './weapons.js';

// 自由模式：任意网页都能计分。不判断元素"该不该切"，只按面积与连击给分。
export const COMBO_WINDOW_MS = 900;

const STYLE = `
  #cleaner-free-score { position: fixed; left: 14px; bottom: 14px; z-index: 2147483648;
    display: none; align-items: center; gap: 6px; padding: 8px 12px; border-radius: 10px;
    background: rgba(12,16,22,.9); border: 1px solid #2b3442; color: #e9eef6;
    font: 12px/1.3 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;
    pointer-events: none; transition: border-color .2s; }
  #cleaner-free-score.on { display: flex; }
  #cleaner-free-score.hot { border-color: #00ffcc; box-shadow: 0 0 14px rgba(0,255,204,.25); }
  #cleaner-free-score .lbl { color: #8593a5; }
  #cleaner-free-score b { font-variant-numeric: tabular-nums; }
  #cleaner-free-score .combo { color: #00ffcc; }
  #cleaner-free-score .sep { color: #3a4553; }
  #cleaner-free-score .gain { position: absolute; right: 12px; top: -18px; font-style: normal;
    font-size: 13px; font-weight: 700; color: #00ffcc; opacity: 0; }
  #cleaner-free-score .gain.pop { animation: cleaner-gain .55s ease-out; }
  @keyframes cleaner-gain {
    0% { opacity: 1; transform: translateY(4px); }
    100% { opacity: 0; transform: translateY(-14px); }
  }
`;

export function createFreeScore() {
  const state = { score: 0, combo: 0, bestCombo: 0, hits: 0, lastAt: null, unit: '刀' };

  let root = null;
  let scoreEl = null;
  let comboEl = null;
  let hitsEl = null;
  let unitEl = null;
  let gainEl = null;
  let resetTimer = null;

  function ensureHud() {
    if (root || typeof document === 'undefined' || !document.body) return;

    if (!document.getElementById('cleaner-free-score-style')) {
      const style = document.createElement('style');
      style.id = 'cleaner-free-score-style';
      style.textContent = STYLE;
      document.head.appendChild(style);
    }

    root = document.createElement('div');
    root.id = 'cleaner-free-score';
    root.setAttribute('data-adslash-ui', '1');
    root.innerHTML =
      '<span class="lbl">分数</span><b data-k="score">0</b>' +
      '<span class="sep">·</span><span class="lbl">连击</span><b class="combo" data-k="combo">×1.00</b>' +
      '<span class="sep">·</span><b data-k="hits">0</b><span class="lbl" data-k="unit">刀</span>' +
      '<i class="gain" data-k="gain"></i>';
    document.body.appendChild(root);

    scoreEl = root.querySelector('[data-k="score"]');
    comboEl = root.querySelector('[data-k="combo"]');
    hitsEl = root.querySelector('[data-k="hits"]');
    unitEl = root.querySelector('[data-k="unit"]');
    gainEl = root.querySelector('[data-k="gain"]');
  }

  function render() {
    if (!root) return;
    scoreEl.textContent = String(state.score);
    comboEl.textContent = '×' + comboMultiplier(state.combo || 1).toFixed(2);
    hitsEl.textContent = String(state.hits);
    unitEl.textContent = state.unit;
    root.classList.toggle('hot', state.combo >= 3);
  }

  function record(info, at) {
    const rect = info && info.rect;
    if (!rect || !(rect.width > 0) || !(rect.height > 0)) return;

    const now = typeof at === 'number' ? at : performance.now();
    const within = state.lastAt != null && now - state.lastAt <= COMBO_WINDOW_MS;

    state.combo = within ? state.combo + 1 : 1;
    state.lastAt = now;
    if (state.combo > state.bestCombo) state.bestCombo = state.combo;

    // 计分随武器变化：近战按面积，枪械按命中固定分
    const weapon = info && info.weapon ? getWeapon(info.weapon) : null;
    state.unit = weapon && weapon.unit ? weapon.unit : '刀';

    const fixed = !!(weapon && weapon.scoring === 'hit' && Number.isFinite(weapon.hitPoints));
    // 激光炮等局部损伤武器按本次新增烧蚀面积给分，其余按整块面积
    const area = Number(info && info.area);
    const points = fixed ? weapon.hitPoints : basePointsForArea(area > 0 ? area : rect.width * rect.height);
    const gain = scoreForSlash([points], state.combo, 0).total;
    state.score += gain;
    state.hits++;

    if (gainEl) {
      gainEl.textContent = '+' + gain;
      gainEl.classList.remove('pop');
      void gainEl.offsetWidth;
      gainEl.classList.add('pop');
    }

    if (resetTimer) clearTimeout(resetTimer);
    resetTimer = setTimeout(() => {
      state.combo = 0;
      state.lastAt = null;
      render();
    }, COMBO_WINDOW_MS);

    render();
  }

  function setActive(active) {
    if (active) {
      state.score = 0;
      state.combo = 0;
      state.bestCombo = 0;
      state.hits = 0;
      state.lastAt = null;
      ensureHud();
      if (root) root.classList.add('on');
      render();    } else if (root) {
      root.classList.remove('on');
      root.classList.remove('hot');
    }
  }

  return {
    record,
    setActive,
    getState: () => ({ ...state }),
  };
}
