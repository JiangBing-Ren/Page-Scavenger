#!/usr/bin/env node
// 静态与逻辑校验：纯函数正确性 + 打包产物可加载并跑通渲染帧 + manifest 合法性
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import { getSplitPolygons, polygonArea } from '../packages/core/src/geometry.js';
import { visibleBox } from '../packages/core/src/fragments.js';
import { DEFAULT_CONFIG, SIZE_LEVELS, HIT_STOPS } from '../packages/core/src/config.js';
import {
  basePointsForArea,
  comboMultiplier,
  decoyPenalty,
  gradeFor,
  scoreForSlash,
  timeBonus,
} from '../packages/core/src/score.js';
import { createFreeScore, COMBO_WINDOW_MS } from '../packages/core/src/freescore.js';
import { splitPolygon, splitPolygonMany } from '../packages/core/src/pieces.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
let failed = 0;

async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL ${name}`);
    console.error('       ' + (err && err.message));
  }
}

console.log('\n[1] 几何切分');

await check('对角线切分（刀线穿过两个顶点）面积守恒', () => {
  const w = 200;
  const h = 200;
  const { polyA, polyB } = getSplitPolygons(w, h, { x: 0, y: h }, 1, -1);
  const total = polygonArea(polyA) + polygonArea(polyB);
  assert.ok(Math.abs(total - w * h) < 0.001, `面积为 ${total}，期望 ${w * h}`);
  assert.ok(Math.abs(polygonArea(polyA) - polygonArea(polyB)) < 0.001, '两块面积应相等');
});

await check('穿过中点的水平线把矩形对半分', () => {
  const w = 200;
  const h = 100;
  const { polyA, polyB } = getSplitPolygons(w, h, { x: 0, y: h / 2 }, 1, 0);
  assert.ok(Math.abs(polygonArea(polyA) - (w * h) / 2) < 0.001);
  assert.ok(Math.abs(polygonArea(polyB) - (w * h) / 2) < 0.001);
  assert.ok(polyA.length >= 3 && polyB.length >= 3);
});

await check('斜穿内部的刀线面积守恒', () => {
  const w = 240;
  const h = 140;
  for (let i = 1; i < 10; i++) {
    const y = (h / 10) * i;
    const { polyA, polyB } = getSplitPolygons(w, h, { x: 0, y }, 1, -0.4);
    const total = polygonArea(polyA) + polygonArea(polyB);
    assert.ok(Math.abs(total - w * h) < 0.01, `y=${y} 面积 ${total}`);
  }
});

await check('退化方向向量不会产生非法多边形', () => {
  const { polyA, polyB } = getSplitPolygons(100, 100, { x: 50, y: 50 }, 0, 0);
  assert.ok(Array.isArray(polyA) && Array.isArray(polyB));
  assert.ok(polyA.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
});

await check('超大容器的可见区域裁剪', () => {
  globalThis.window = { innerWidth: 1000, innerHeight: 800 };

  const clipped = visibleBox({ left: -50, top: -100, right: 1500, bottom: 2000 });
  assert.deepEqual(clipped, { left: 0, top: 0, width: 1000, height: 800 });

  const inside = visibleBox({ left: 100, top: 100, right: 300, bottom: 300 });
  assert.deepEqual(inside, { left: 100, top: 100, width: 200, height: 200 });

  const partial = visibleBox({ left: 900, top: 700, right: 1200, bottom: 1000 });
  assert.deepEqual(partial, { left: 900, top: 700, width: 100, height: 100 });

  const outside = visibleBox({ left: 1200, top: 900, right: 1500, bottom: 1200 });
  assert.equal(outside.width, 0);
  assert.equal(outside.height, 0);
});

console.log('\n[2] 手感参数锁定');
await check('关键数值与 v0.4.0 调优结果一致', () => {
  assert.equal(DEFAULT_CONFIG.trailLength, 25);
  assert.equal(DEFAULT_CONFIG.trailLifeMs, 160);
  assert.equal(DEFAULT_CONFIG.sampleStep, 4);
  assert.equal(DEFAULT_CONFIG.pierceRatio, 0.6);
  assert.equal(DEFAULT_CONFIG.hitStop, 40);
  assert.equal(DEFAULT_CONFIG.maxTargetRatio, 0.85);
  assert.equal(DEFAULT_CONFIG.maxAncestorDepth, 15);
  assert.equal(DEFAULT_CONFIG.allowOversize, false, '超大容器默认必须关闭，保持旧手感');
  assert.deepEqual(SIZE_LEVELS, ['auto', 'balance', 'large', 'medium', 'small']);
  assert.deepEqual(HIT_STOPS, [0, 20, 40, 80, 120]);
});

console.log('\n[3] 打包产物');

function makeCtx() {
  return new Proxy(
    {},
    {
      get(target, prop) {
        if (prop in target) return target[prop];
        return () => {};
      },
      set(target, prop, value) {
        target[prop] = value;
        return true;
      },
    }
  );
}

function makeEl(tag) {
  return {
    tagName: (tag || 'div').toUpperCase(),
    nodeType: 1,
    id: '',
    className: '',
    textContent: '',
    innerText: '',
    innerHTML: '',
    value: '',
    checked: false,
    disabled: false,
    children: [],
    style: { setProperty() {}, removeProperty() {} },
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    removeChild() {},
    setAttribute() {},
    removeAttribute() {},
    hasAttribute: () => false,
    addEventListener() {},
    removeEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    matches: () => false,
    contains: () => false,
    getContext: () => makeCtx(),
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      right: 100,
      bottom: 50,
      width: 100,
      height: 50,
    }),
  };
}

function createSandbox(ext) {
  const noop = () => {};
  const byId = new Map();
  const errors = [];
  let rafCount = 0;

  const win = {
    innerWidth: 1280,
    innerHeight: 800,
    devicePixelRatio: 1,
    addEventListener: noop,
    removeEventListener: noop,
    getComputedStyle: () => ({ display: 'block', backgroundColor: 'rgba(0, 0, 0, 0)' }),
  };

  const doc = {
    readyState: 'complete',
    body: makeEl('body'),
    documentElement: makeEl('html'),
    createElement: (tag) => makeEl(tag),
    getElementById(id) {
      if (!byId.has(id)) byId.set(id, makeEl());
      return byId.get(id);
    },
    addEventListener: noop,
    removeEventListener: noop,
    elementsFromPoint: () => [],
    querySelector: () => null,
    querySelectorAll: () => [],
  };

  const sandbox = {
    console: { log: noop, warn: noop, error: (...a) => errors.push(a.join(' ')) },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    performance: { now: () => Date.now() },
    requestAnimationFrame(cb) {
      const id = ++rafCount;
      if (rafCount <= 3) setTimeout(() => {
        try {
          cb(Date.now());
        } catch (e) {
          errors.push(e);
        }
      }, 0);
      return id;
    },
    cancelAnimationFrame: noop,
    CSS: { escape: (s) => s },
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    localStorage: {
      _d: {},
      getItem(k) {
        return k in this._d ? this._d[k] : null;
      },
      setItem(k, v) {
        this._d[k] = String(v);
      },
      removeItem(k) {
        delete this._d[k];
      },
    },
    window: win,
    document: doc,
    location: { hostname: 'example.com', href: 'https://example.com/' },
    navigator: { userAgent: 'node' },
    chrome: ext,
    alert: noop,
  };

  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  win.document = doc;
  win.top = win;
  win.location = sandbox.location;

  return { sandbox, errors };
}

function createExtStub() {
  const store = { local: {}, sync: {} };
  const area = (bucket) => ({
    async get(k) {
      return k in bucket ? { [k]: bucket[k] } : {};
    },
    async set(obj) {
      Object.assign(bucket, obj);
    },
    async remove(k) {
      delete bucket[k];
    },
  });

  return {
    storage: { local: area(store.local), sync: area(store.sync) },
    runtime: {
      onMessage: { addListener: () => {} },
      onInstalled: { addListener: () => {} },
      onStartup: { addListener: () => {} },
      sendMessage: async () => undefined,
      lastError: undefined,
      getURL: (p) => 'chrome-extension://test/' + p,
    },
    action: { setBadgeText: () => {}, setBadgeBackgroundColor: () => {} },
    tabs: {
      sendMessage: async () => undefined,
      query: async () => [],
      create: () => {},
      onUpdated: { addListener: () => {} },
    },
    contextMenus: { create: () => {}, removeAll: () => {}, onClicked: { addListener: () => {} } },
    commands: { onCommand: { addListener: () => {} } },
  };
}

async function runBundle(rel, ext) {
  const code = await fs.readFile(path.join(ROOT, rel), 'utf8');
  const { sandbox, errors } = createSandbox(ext);
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { timeout: 5000 });
  await new Promise((r) => setTimeout(r, 40));
  assert.deepEqual(errors, [], `运行期异常：${errors.map(String).join(' | ')}`);
}

const BUNDLES = [
  'dist/extension/content.js',
  'dist/extension/background.js',
  'dist/extension/popup/popup.js',
  'dist/extension/levels/tutorial.js',
  'dist/extension-firefox/content.js',
  'dist/extension-firefox/background.js',
];

for (const rel of BUNDLES) {
  await check(`${rel} 可加载并跑通渲染帧`, () => runBundle(rel, createExtStub()));
}

await check('油猴版可在无扩展环境加载', () => runBundle('dist/页面清道夫.user.js', undefined));

console.log('\n[4] manifest');

const MANIFESTS = ['dist/extension/manifest.json', 'dist/extension-firefox/manifest.json'];

for (const rel of MANIFESTS) {
  await check(`${rel} 字段完整`, async () => {
    const json = JSON.parse(await fs.readFile(path.join(ROOT, rel), 'utf8'));
    assert.equal(json.manifest_version, 3);
    assert.ok(json.name && json.version);
    assert.ok(json.content_scripts && json.content_scripts.length === 1);
    assert.deepEqual(json.content_scripts[0].matches, ['<all_urls>']);
    assert.equal(json.content_scripts[0].run_at, 'document_start');
    assert.ok(json.permissions.includes('storage'));
    assert.ok(json.action && json.action.default_popup);
    assert.ok(json.background.service_worker || json.background.scripts, '缺 background 入口');
  });
}

console.log('\n[5] 核心与宿主解耦');

await check('packages/core 内不出现 chrome./browser. 调用', async () => {
  const dir = path.join(ROOT, 'packages/core/src');
  const files = await fs.readdir(dir);
  for (const f of files) {
    const text = await fs.readFile(path.join(dir, f), 'utf8');
    assert.ok(!/\bchrome\s*\./.test(text), `${f} 出现了 chrome.`);
    assert.ok(!/\bbrowser\s*\./.test(text), `${f} 出现了 browser.`);
  }
});

await check('打包产物里不残留 import/export 语句', async () => {
  for (const rel of BUNDLES.concat('dist/页面清道夫.user.js')) {
    const code = await fs.readFile(path.join(ROOT, rel), 'utf8');
    assert.ok(!/^\s*import\s/m.test(code), `${rel} 残留 import`);
    assert.ok(!/^\s*export\s/m.test(code), `${rel} 残留 export`);
  }
});

console.log('\n[6] 关卡计分');

await check('面积分档', () => {
  assert.equal(basePointsForArea(10000), 10);
  assert.equal(basePointsForArea(20000), 20);
  assert.equal(basePointsForArea(100000), 40);
  assert.equal(basePointsForArea(300000), 80);
  assert.equal(basePointsForArea(0), 10);
  assert.equal(basePointsForArea(NaN), 10);
});

await check('连击倍率与上限', () => {
  assert.equal(comboMultiplier(1), 1);
  assert.equal(comboMultiplier(2), 1.25);
  assert.equal(comboMultiplier(5), 2);
  assert.equal(comboMultiplier(9), 3);
  assert.equal(comboMultiplier(25), 3, '倍率必须封顶 3');
  assert.equal(comboMultiplier(0), 1);
});

await check('禁区扣分与时间奖励', () => {
  assert.equal(decoyPenalty(0), 0);
  assert.equal(decoyPenalty(2), 50);
  assert.equal(decoyPenalty(-3), 0);
  assert.equal(timeBonus(0), 0);
  assert.equal(timeBonus(10), 20);
  assert.equal(timeBonus(-5), 0);
});

await check('评级阈值', () => {
  const t = { s: 560, a: 420, b: 300 };
  assert.equal(gradeFor(600, t), 'S');
  assert.equal(gradeFor(560, t), 'S');
  assert.equal(gradeFor(500, t), 'A');
  assert.equal(gradeFor(350, t), 'B');
  assert.equal(gradeFor(100, t), 'C');
  assert.equal(gradeFor(99999, {}), 'C', '缺阈值时不得误判为 S');
});

await check('单刀结算', () => {
  const plain = scoreForSlash([20, 20], 1, 0);
  assert.equal(plain.base, 40);
  assert.equal(plain.total, 40);

  const combo = scoreForSlash([20, 20], 3, 0);
  assert.equal(combo.total, 60, '3 连击 1.5 倍');

  const miss = scoreForSlash([], 1, 2);
  assert.equal(miss.total, -50);

  const mixed = scoreForSlash([40], 1, 1);
  assert.equal(mixed.total, 15);
});

console.log('\n[7] 自由模式计分');
await check('连续快切累积连击', () => {
  const score = createFreeScore();
  const rect = { width: 200, height: 150 }; // 30000 px² → 基础 20 分
  score.record({ rect }, 1000);
  score.record({ rect }, 1100);
  score.record({ rect }, 1200);

  const state = score.getState();
  assert.equal(state.combo, 3);
  assert.equal(state.hits, 3);
  assert.equal(state.score, 20 + 25 + 30);
});

await check('超出连击窗口后重新从 1 起算', () => {
  const score = createFreeScore();
  const rect = { width: 200, height: 150 };
  score.record({ rect }, 1000);
  score.record({ rect }, 1000 + COMBO_WINDOW_MS + 1);

  assert.equal(score.getState().combo, 1);
  assert.equal(score.getState().score, 40);
});

await check('自由模式倍率同样封顶 3 倍', () => {
  const score = createFreeScore();
  const rect = { width: 200, height: 150 };
  let expected = 0;
  for (let i = 1; i <= 12; i++) {
    score.record({ rect }, 1000 + i * 100);
    expected += scoreForSlash([20], i, 0).total;
  }
  assert.equal(score.getState().combo, 12);
  assert.equal(score.getState().score, expected);
  assert.equal(comboMultiplier(12), 3);
});

console.log('\n[8] 碎片再切');

const SQUARE = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
];

await check('沿中线把碎片对半分开', () => {
  const { left, right } = splitPolygon(SQUARE, { x: 0, y: 50 }, 1, 0);
  assert.ok(left.length >= 3 && right.length >= 3);
  assert.ok(Math.abs(polygonArea(left) + polygonArea(right) - 10000) < 0.01);
  assert.ok(Math.abs(polygonArea(left) - polygonArea(right)) < 0.01);
});

await check('刀线穿过顶点时面积守恒', () => {
  const { left, right } = splitPolygon(SQUARE, { x: 0, y: 0 }, 1, 1);
  assert.ok(Math.abs(polygonArea(left) + polygonArea(right) - 10000) < 0.01);
  assert.ok(Math.abs(polygonArea(left) - polygonArea(right)) < 0.01);
});

await check('刀线完全在碎片外侧时只产生一块', () => {
  const { left, right } = splitPolygon(SQUARE, { x: 0, y: -50 }, 1, 0);
  assert.equal(right.length, 0);
  assert.ok(Math.abs(polygonArea(left) - 10000) < 0.01);
});

console.log('\n[9] 多刀蓄力');

await check('两条互相垂直的刀线切成 4 块', () => {
  const cuts = [
    { a: { x: 0, y: 50 }, dx: 1, dy: 0 },
    { a: { x: 50, y: 0 }, dx: 0, dy: 1 },
  ];
  const polys = splitPolygonMany(SQUARE, cuts, 0);
  assert.equal(polys.length, 4);
  const total = polys.reduce((sum, p) => sum + polygonArea(p), 0);
  assert.ok(Math.abs(total - 10000) < 0.01);
});

await check('三条平行刀线切成 4 块且面积正确', () => {
  const cuts = [10, 30, 70].map((y) => ({ a: { x: 0, y }, dx: 1, dy: 0 }));
  const polys = splitPolygonMany(SQUARE, cuts, 0);
  assert.equal(polys.length, 4);
  const areas = polys.map(polygonArea).sort((a, b) => a - b);
  assert.deepEqual(
    areas.map((a) => Math.round(a)),
    [1000, 2000, 3000, 4000]
  );
});

await check('刀线在碎片外部时不增加块数', () => {
  const polys = splitPolygonMany(SQUARE, [{ a: { x: 0, y: -50 }, dx: 1, dy: 0 }], 0);
  assert.equal(polys.length, 1);
});

console.log(`\n通过 ${passed} 项，失败 ${failed} 项。`);
if (failed) process.exitCode = 1;
