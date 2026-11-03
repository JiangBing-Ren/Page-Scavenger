import { createCleaner } from '../../../core/src/engine.js';
import {
  SIZE_LEVELS,
  SIZE_LABELS,
  HIT_STOPS,
  HIT_STOP_LABELS,
} from '../../../core/src/config.js';

const STORE_KEY = 'adslash.tutorial.marks';

const storage = {
  async loadMarks() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  },
  saveMarks(list) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(list));
    } catch (e) {}
  },
  clearMarks() {
    try {
      localStorage.removeItem(STORE_KEY);
    } catch (e) {}
  },
};

const steps = { cut: false, combo: false, size: false, hitStop: false, release: false };
let lastSlashAt = 0;

function tick(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('done');
}

const cleaner = createCleaner({
  storage,
  onSlash() {
    const t = performance.now();

    if (!steps.cut) {
      steps.cut = true;
      tick('s1');
    }

    if (!steps.combo && lastSlashAt && t - lastSlashAt < 700) {
      steps.combo = true;
      tick('s2');
    }

    lastSlashAt = t;
  },
});

const config = cleaner.getConfig();

function renderControls() {
  document.getElementById('btn-size').textContent = '挡位：' + SIZE_LABELS[config.targetSizeLevel];
  document.getElementById('btn-hitstop').textContent =
    '顿感：' + (HIT_STOP_LABELS[config.hitStop] || config.hitStop);
  document.getElementById('btn-release').textContent =
    '松手再切：' + (config.executeOnRelease ? '开' : '关');
}

document.getElementById('btn-size').addEventListener('click', () => {
  const idx = SIZE_LEVELS.indexOf(config.targetSizeLevel);
  const next = SIZE_LEVELS[(idx + 1) % SIZE_LEVELS.length];
  cleaner.setConfig({ targetSizeLevel: next });
  renderControls();

  if (!steps.size) {
    steps.size = true;
    tick('s3');
  }
});

document.getElementById('btn-hitstop').addEventListener('click', () => {
  const idx = HIT_STOPS.indexOf(config.hitStop);
  const next = HIT_STOPS[(idx + 1) % HIT_STOPS.length];
  cleaner.setConfig({ hitStop: next });
  renderControls();

  if (!steps.hitStop) {
    steps.hitStop = true;
    tick('s4');
  }
});

let releaseBaseline = null;

document.getElementById('btn-release').addEventListener('click', () => {
  const next = !config.executeOnRelease;
  cleaner.setConfig({ executeOnRelease: next });
  renderControls();

  if (next) {
    releaseBaseline = cleaner.getSlashCount();
    pollRelease();
  } else {
    releaseBaseline = null;
  }
});

function pollRelease() {
  if (releaseBaseline == null) return;
  if (cleaner.getSlashCount() > releaseBaseline) {
    releaseBaseline = null;
    if (!steps.release) {
      steps.release = true;
      tick('s5');
    }
    return;
  }
  requestAnimationFrame(pollRelease);
}

document.getElementById('btn-reset').addEventListener('click', () => {
  cleaner.clearMarks();
  location.reload();
});

renderControls();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => cleaner.activate(), { once: true });
} else {
  cleaner.activate();
}
