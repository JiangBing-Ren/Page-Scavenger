#!/usr/bin/env node
// 静态与逻辑校验：纯函数正确性 + 打包产物可加载并跑通渲染帧 + manifest 合法性
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import { getSplitPolygons, polygonArea, signedArea, ensureWinding } from '../packages/core/src/geometry.js';
import { visibleBox } from '../packages/core/src/fragments.js';
import {
  DEFAULT_CONFIG,
  SIZE_LEVELS,
  HIT_STOPS,
  CANNON_BREAK_STYLES,
  BLADE_STYLES,
  LASER_STYLES,
  LASER_SOUND_STYLES,
} from '../packages/core/src/config.js';
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
import { WEAPONS, getWeapon, implementedWeapons, blastSamplePoints } from '../packages/core/src/weapons.js';
import { drawBlackholes, drawShatterWipes, drawSlashWipes, renderSlashWipeTrail } from '../packages/core/src/render.js';
import { drawLaserEmitter, drawLaserColumn, drawBurnEdges } from '../packages/core/src/laserfx.js';
import { buildBurnBand, applyBurn, restoreBurn, activeBurnEdges, clearBurns, burnCount } from '../packages/core/src/burns.js';
import { buildShatterPattern, SHATTER_IMPACT, SHATTER_BURST } from '../packages/core/src/shatter.js';
import { buildSlashPattern, SLASH_EDGE_END, SLASH_SLIP, SLASH_SPLIT } from '../packages/core/src/slashwipe.js';
import { SAMPLE_ASSETS } from '../packages/core/src/sound.js';
import { chargeWidthMul, OVERCHARGE_WIDTH_CAP, bladeSfxForCut } from '../packages/core/src/engine.js';

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
  'dist/extension/play/levels/tutorial.js',
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

await check('桌面版主进程与预加载脚本语法正确', async () => {
  const files = [
    'packages/desktop/src/main.js',
    'packages/desktop/src/shell/shell-preload.js',
  ];
  for (const rel of files) {
    const code = await fs.readFile(path.join(ROOT, rel), 'utf8');
    // 只解析不执行：main.js 的语法错误会让整个 Electron 主进程起不来
    new vm.Script(code, { filename: rel });
  }
});

await check('桌面版打包产物语法正确', async () => {
  const files = [
    'dist/desktop/page-preload.js',
    'dist/desktop/shell/shell.js',
    'dist/desktop/shell/guide.js',
    'dist/desktop/config/config.js',
  ];
  for (const rel of files) {
    const code = await fs.readFile(path.join(ROOT, rel), 'utf8');
    new vm.Script(code, { filename: rel });
  }
});

await check('关卡与配置器产物语法正确（不执行）', async () => {
  const files = [
    'dist/extension/play/levels/runner.js',
    'dist/extension/play/levels/tutorial.js',
    'dist/extension/config/config.js',
    'dist/extension-firefox/play/levels/runner.js',
    'dist/extension-firefox/config/config.js',
  ];
  for (const rel of files) {
    const code = await fs.readFile(path.join(ROOT, rel), 'utf8');
    new vm.Script(code, { filename: rel });
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

console.log('\n[10] 武器框架');

await check('注册表包含全部 11 种武器且 id 不重复', () => {
  assert.equal(WEAPONS.length, 11);
  assert.equal(new Set(WEAPONS.map((w) => w.id)).size, 11);
});

await check('每种武器字段完整、输入方式合法', () => {
  const inputs = ['drag', 'click', 'hold', 'charge', 'drop'];
  for (const weapon of WEAPONS) {
    assert.ok(weapon.id && weapon.name && weapon.group && weapon.desc, weapon.id || '?');
    assert.ok(inputs.includes(weapon.input), `${weapon.id} input=${weapon.input}`);
    assert.equal(typeof weapon.implemented, 'boolean', `${weapon.id} implemented`);
  }
});

await check('框架阶段已实现：刀、炮、左轮、机枪、激光炮、黑洞', () => {
  assert.deepEqual(
    implementedWeapons().map((w) => w.id),
    ['blade', 'cannon', 'revolver', 'machinegun', 'laser', 'blackhole']
  );  assert.equal(getWeapon('blackhole').id, 'blackhole');
  assert.equal(getWeapon('nope'), null);
  assert.equal(DEFAULT_CONFIG.weapon, 'blade');
});

await check('黑洞是 drop 类、按面积计分、参数为正', () => {
  const bh = getWeapon('blackhole');
  assert.equal(bh.input, 'drop');
  assert.equal(bh.scoring, 'area');
  assert.ok(DEFAULT_CONFIG.blackholeRadius > 0);
  assert.ok(DEFAULT_CONFIG.blackholeDurationMs >= 300);
  assert.ok(DEFAULT_CONFIG.blackholeCooldown >= 0);
  assert.ok(DEFAULT_CONFIG.blackholeFieldRatio > 0 && DEFAULT_CONFIG.blackholeFieldRatio <= 1);
  assert.ok(DEFAULT_CONFIG.blackholeCaptureRatio > 1);
  assert.ok(DEFAULT_CONFIG.blackholeTearRatio > 0);
  assert.ok(DEFAULT_CONFIG.blackholeTearRatio < DEFAULT_CONFIG.blackholeCaptureRatio);
  assert.ok(
    DEFAULT_CONFIG.blackholeGrowEfficiency > 0 && DEFAULT_CONFIG.blackholeGrowEfficiency < 1
  );
  assert.ok(DEFAULT_CONFIG.blackholeMaxAreaRatio > 0 && DEFAULT_CONFIG.blackholeMaxAreaRatio < 1);
});

await check('爆破采样点：圆心 + 一圈环点', () => {
  const points = blastSamplePoints(100, 100, 140);
  assert.equal(points.length, 9);
  assert.deepEqual(points[0], { x: 100, y: 100 });

  const dist = Math.hypot(points[1].x - 100, points[1].y - 100);
  assert.ok(Math.abs(dist - 140 * 0.7) < 0.001, '环点半径应为 0.7R');

  for (const p of points.slice(1)) {
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
  }
});

await check('裂缝形态参数有默认值且为正数', () => {
  for (const key of ['crackWidth', 'crackLength', 'crackStartWidth', 'crackEndWidth']) {
    const value = DEFAULT_CONFIG[key];
    assert.equal(typeof value, 'number', `${key} 应为数字`);
    assert.ok(value > 0, `${key} 应大于 0`);
  }
  assert.ok(DEFAULT_CONFIG.crackStartWidth > DEFAULT_CONFIG.crackEndWidth, '起点应比末端宽');
});

await check('遮罩挖空依赖绕向：洞必须与外框反向', () => {
  const rect = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ];
  const rectSign = Math.sign(signedArea(rect));
  assert.notEqual(rectSign, 0);

  const hole = [
    { x: 10, y: 10 },
    { x: 30, y: 10 },
    { x: 30, y: 30 },
    { x: 10, y: 30 },
  ];

  const a = ensureWinding(hole, true);
  assert.ok(signedArea(a) < 0, '应为负号面积');
  assert.notEqual(Math.sign(signedArea(a)), rectSign, '必须与外框相反');

  const b = ensureWinding(hole.slice().reverse(), true);
  assert.ok(signedArea(b) < 0, '反向输入也要归一化到负号');
});

console.log('\n[11] 黑洞视觉形态');

await check('3D / 2D 两套渲染可切换且缺省为 3D', () => {
  const calls = [];
  // 只记录绘制调用：3D 版用 ellipse 画倾斜吸积盘，2D 版只用 lineTo 画漩涡臂
  const ctx = new Proxy({}, {
    get(_t, key) {
      if (key === 'createRadialGradient') return () => ({ addColorStop() {} });
      return () => calls.push(key);
    },
    set() { return true; },
  });
  const state = { blackholes: [{ x: 100, y: 100, radius: 80, pulseAt: 0 }] };
  const run = (config) => {
    calls.length = 0;
    drawBlackholes(ctx, state, config);
    return {
      ellipse: calls.filter((c) => c === 'ellipse').length,
      lineTo: calls.filter((c) => c === 'lineTo').length,
    };
  };

  const disk = run({ blackholeStyle: '3d' });
  const flat = run({ blackholeStyle: '2d' });
  const fallback = run(undefined);

  assert.ok(disk.ellipse > 0, '3D 版应画出椭圆吸积盘');
  assert.equal(flat.ellipse, 0, '2D 版不应画椭圆盘');
  assert.ok(flat.lineTo > disk.lineTo, '2D 版应画出三臂漩涡');
  assert.equal(fallback.ellipse, disk.ellipse, '缺省配置必须回到 3D 版');
});

console.log('\n[12] 炮破碎形态');

await check('破碎形态与时长默认值', () => {
  assert.equal(DEFAULT_CONFIG.cannonBreakStyle, 'classic', '默认必须保持经典放射裂纹');
  assert.equal(DEFAULT_CONFIG.shatterDurationMs, 1400);
  assert.deepEqual(CANNON_BREAK_STYLES, ['classic', 'shatter']);
});

await check('Shatter wipe 楔形网格、裂纹时序与叠加层', () => {
  // 确定性随机源，保证校验结果可复现
  const R = { range: (a, b) => (a + b) / 2, chance: () => true, sign: () => 1 };
  const pat = buildShatterPattern(300, 250, 150, 120, R);

  assert.ok(pat.cells.length > 0 && pat.cells.length <= 16, `碎片数越界：${pat.cells.length}`);
  assert.ok(pat.cells.every((c) => c.pts.length >= 3), '每块碎片必须是多边形');
  assert.ok(pat.cells.every((c) => c.tb >= SHATTER_BURST), '碎裂不得早于炸裂时刻');
  assert.ok(pat.cracks.length > 0 && pat.cracks.length < 240, '裂纹数必须保持轻量');
  const branches = pat.cracks.filter((c) => c.branch).length;
  assert.ok(branches > 0, '主裂纹必须派生分叉，不能退化成直线');
  assert.ok(branches < pat.cracks.length, '分叉不能取代主裂纹');
  assert.ok(
    pat.cracks.every((c) =>
      [c.ax, c.bx].every((x) => x >= 0 && x <= 300) && [c.ay, c.by].every((y) => y >= 0 && y <= 250)
    ),
    '裂纹不得越出目标矩形'
  );
  assert.ok(pat.cracks.every((c, i) => i === 0 || pat.cracks[i - 1].t0 <= c.t0), '裂纹必须按 t0 升序');
  assert.ok(
    pat.cracks.every((c) => c.t0 >= SHATTER_IMPACT && c.t0 <= SHATTER_BURST),
    '裂纹时刻必须落在撞击与炸裂之间'
  );

  const calls = [];
  const ctx = new Proxy({}, {
    get(_t, key) {
      if (key === 'createRadialGradient') return () => ({ addColorStop() {} });
      return () => calls.push(key);
    },
    set() { return true; },
  });
  const state = {
    shatterWipes: [{
      x: 250,
      y: 225,
      t0: performance.now() - 700,
      durationMs: 1400,
      impact: SHATTER_IMPACT,
      burst: SHATTER_BURST,
      left: 100,
      top: 100,
      width: 300,
      height: 250,
      hole: [[220, 225], [250, 195], [280, 225], [250, 255]],
      cracks: pat.cracks.map((c) => ({ ...c })),
    }],
  };

  drawShatterWipes(ctx, state);
  const strokes = calls.filter((k) => k === 'stroke').length;
  assert.ok(strokes > 0, '裂纹层应画出线段');
  assert.ok(strokes <= 6, `裂纹必须批量绘制，实际 stroke ${strokes} 次`);
  assert.ok(calls.filter((k) => k === 'clip').length > 0, '裂纹层必须裁剪到目标矩形');
  assert.ok(calls.filter((k) => k === 'closePath').length > 0, '弹孔必须使用 evenodd 复合裁剪');
  assert.equal(
    calls.filter((k) => k === 'save').length,
    calls.filter((k) => k === 'restore').length,
    'canvas 状态必须配对'
  );
  assert.equal(state.shatterWipes.length, 1, '未到期的特效不应被移除');

  state.shatterWipes[0].t0 = performance.now() - 1500;
  drawShatterWipes(ctx, state);
  assert.equal(state.shatterWipes.length, 0, '到期的特效应被清理');
});

console.log('\n[13] 刀斩击形态');

await check('斩击形态与序列时长默认值', () => {
  assert.equal(DEFAULT_CONFIG.bladeStyle, 'classic', '默认必须保持经典蓝白刀光');
  assert.equal(DEFAULT_CONFIG.bladeFxDurationMs, 420);
  assert.deepEqual(BLADE_STYLES, ['classic', 'slash']);
});

await check('Slash wipe 刀线几何、时间轴与叠加层', () => {
  const pat = buildSlashPattern(300, 250, { x: 150, y: 120 }, { x: 1, y: 0.55 });
  assert.ok(pat.length > 0, '刀线长度必须为正');
  assert.ok(
    [pat.A, pat.B].every((pt) => pt[0] >= -1e-6 && pt[0] <= 300 + 1e-6 && pt[1] >= -1e-6 && pt[1] <= 250 + 1e-6),
    '刀线端点必须落在目标内'
  );
  assert.ok(Math.abs(pat.nx * pat.ux + pat.ny * pat.uy) < 1e-6, '法线必须垂直于刀线');
  assert.ok(SLASH_EDGE_END < SLASH_SLIP && SLASH_SLIP < SLASH_SPLIT, '时间轴必须递增');

  const calls = [];
  const ctx = new Proxy({}, {
    get(_t, key) {
      if (key === 'createRadialGradient') return () => ({ addColorStop() {} });
      return () => calls.push(key);
    },
    set() { return true; },
  });
  const state = {
    slashWipes: [{
      a: [100, 190],
      b: [400, 280],
      ux: 0.88,
      uy: 0.48,
      nx: -0.48,
      ny: 0.88,
      length: 313,
      durationMs: 600,
      hitStop: 40,
      edgeEnd: SLASH_EDGE_END,
      slip: SLASH_SLIP,
      split: SLASH_SPLIT,
      left: 100,
      top: 100,
      width: 300,
      height: 250,
      t0: performance.now() - 300,
    }],
  };

  drawSlashWipes(ctx, state);
  const strokes = calls.filter((k) => k === 'stroke').length;
  assert.ok(strokes > 0 && strokes <= 8, `特效应批量绘制，实际 stroke ${strokes} 次`);
  assert.ok(calls.filter((k) => k === 'clip').length > 0, '特效必须裁剪到目标矩形');
  assert.equal(
    calls.filter((k) => k === 'save').length,
    calls.filter((k) => k === 'restore').length,
    'canvas 状态必须配对'
  );
  assert.equal(state.slashWipes.length, 1, '未到期的特效不应被移除');

  state.slashWipes[0].t0 = performance.now() - 700;
  drawSlashWipes(ctx, state);
  assert.equal(state.slashWipes.length, 0, '到期的特效应被清理');

  calls.length = 0;
  renderSlashWipeTrail(ctx, [{ x: 0, y: 0 }, { x: 40, y: 20 }, { x: 90, y: 50 }], 14, 0.8);
  assert.ok(calls.filter((k) => k === 'stroke').length > 0, '白热轨迹应画出核心线');
});

await check('多刀音效按刀序取档，最后一刀固定为最后一击', () => {
  // 把音效名压成数字便于比对：bladeSwing→1、bladeSwingN→N、bladeFinish→5
  const seq = (n) =>
    Array.from({ length: n }, (_, i) =>
      bladeSfxForCut(i + 1, n).replace('bladeFinish', '5').replace('bladeSwing', '') || '1'
    ).join('');

  // 第 1 刀固定 1、最后一刀固定 5，中间按 2-3-4 / 3-4-2 / 4-2-3 轮换
  assert.equal(seq(5), '12345');
  assert.equal(seq(6), '123435');
  assert.equal(seq(7), '1234345');
  assert.equal(seq(8), '12343425');
  assert.equal(seq(11), '12343424235');

  assert.equal(bladeSfxForCut(0), 'bladeSwing', '越界刀序应回落到第 1 刀');
  assert.equal(
    bladeSfxForCut(5),
    'bladeSwing3',
    '不传总刀数时判定不出最后一刀，第 5 刀应顺延进中间循环'
  );

  for (const key of ['bladeSwing', 'bladeSwing2', 'bladeSwing3', 'bladeSwing4', 'bladeFinish']) {
    assert.ok(SAMPLE_ASSETS[key], `${key} 需登记采样槽位`);
  }
});

console.log('\n[14] 激光炮：蓄力贯穿与局部烧蚀');

await check('注册与蓄力配置默认值', () => {
  const laser = getWeapon('laser');
  assert.equal(laser.implemented, true);
  assert.equal(laser.input, 'charge');
  assert.equal(laser.unit, '束');
  assert.equal(laser.scoring, 'area');
  assert.ok(laser.hitFilter, '命中滤镜不能为空');
  assert.equal(DEFAULT_CONFIG.laserStyle, 'column');
  assert.equal(DEFAULT_CONFIG.laserSoundStyle, 'sample', '默认应优先真实采样');
  assert.ok(DEFAULT_CONFIG.laserWidth > 0);
  assert.ok(DEFAULT_CONFIG.laserChargeMs >= 200);
  assert.ok(DEFAULT_CONFIG.laserRange >= 200);
  assert.ok(DEFAULT_CONFIG.laserBurnThreshold > 0 && DEFAULT_CONFIG.laserBurnThreshold <= 1);
  assert.ok(DEFAULT_CONFIG.laserMaxTargets >= 1);
  assert.deepEqual(LASER_STYLES, ['column']);
  assert.deepEqual(LASER_SOUND_STYLES, ['synth', 'sample']);

  // 过量蓄力：满蓄力 1 倍，继续按住线性涨到 3 倍
  assert.ok(DEFAULT_CONFIG.laserOverchargeMs >= 200, '过量蓄力时长必须有默认值');
  assert.equal(OVERCHARGE_WIDTH_CAP, 3, '过量蓄力宽度上限应为满蓄力的 3 倍');
  assert.ok(Math.abs(chargeWidthMul(1, 0) - 1) < 1e-6, '满蓄力宽度倍率应为 1');
  assert.ok(Math.abs(chargeWidthMul(1, 1) - 3) < 1e-6, '过量蓄满宽度倍率应为 3');
  assert.ok(Math.abs(chargeWidthMul(0, 0) - 0.35) < 1e-6, '短按宽度倍率应为 0.35');
  assert.ok(chargeWidthMul(1, 0.5) > chargeWidthMul(1, 0), '过量蓄力必须单调增宽');
  assert.ok(chargeWidthMul(2, 2) <= OVERCHARGE_WIDTH_CAP + 1e-6, '超出上限不得继续变宽');
});

await check('烧蚀带几何、复合 mask 与阈值结算', () => {
  const bounds = { w: 100, h: 100 };
  const band = buildBurnBand({ x: 0, y: 50 }, { x: 100, y: 50 }, 12, 7, bounds);
  assert.ok(band, '应生成烧蚀带');
  assert.ok(band.poly.length >= 4, 'mask 应是有起伏的多边形');
  assert.ok(band.area > 0, '烧蚀面积必须为正');
  assert.equal(band.left.length, band.right.length);
  assert.ok(new Set(band.left.map((p) => p[1].toFixed(2))).size > 3, '焦边必须参差，不能是直线');
  // 与光柱对齐：整体宽度仍在 2*half 附近（允许 ±12% 起伏），不能收窄成点
  const ys = band.poly.map((p) => p[1]);
  const span = Math.max(...ys) - Math.min(...ys);
  assert.ok(span > 24 * 0.75, `烧蚀带宽度 ${span.toFixed(1)}px 明显窄于光柱`);
  assert.ok(
    band.poly.every(([x, y]) => x >= -1e-6 && x <= 100 + 1e-6 && y >= -1e-6 && y <= 100 + 1e-6),
    '烧蚀带必须裁在元素矩形内'
  );
  assert.equal(
    buildBurnBand({ x: 0, y: 50 }, { x: 1, y: 50 }, 12, 3, bounds),
    null,
    '擦边退化成点时不产生烧痕'
  );

  const el = {
    style: {
      maskImage: '', webkitMaskImage: '', maskSize: '', maskRepeat: '',
      webkitMaskSize: '', webkitMaskRepeat: '',
    },
    isConnected: true,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100 }),
  };

  const r1 = applyBurn(el, band, { threshold: 0.9 });
  assert.ok(String(el.style.maskImage).length > 10, '元素应挂上复合 mask');
  assert.ok(r1.ratio > 0 && r1.complete === false, '首发射不应直接烧毁目标');
  assert.equal(activeBurnEdges(1000, 1e6).length, 0, '延迟未到前灼烧不应出现');
  const liveEdges = activeBurnEdges(1000, 0);
  assert.ok(liveEdges.length >= 1, '延迟到期后灼烧应可见');
  assert.ok(
    liveEdges.every((e) => e.phase === 'glow'),
    '刚烧完应处于余温发光阶段（之后才转成永久焦痕 scar）'
  );

  const r2 = applyBurn(el, buildBurnBand({ x: 0, y: 20 }, { x: 100, y: 20 }, 12, 11, bounds), { threshold: 0.9 });
  assert.ok(r2.ratio > r1.ratio, '多次命中必须累积烧蚀面积');
  assert.equal(burnCount(), 1, '同一元素只应有一条损伤记录');
  assert.ok(activeBurnEdges(1000).length >= 2, '发热中的焦边应能被 canvas 读取');

  const r3 = applyBurn(el, buildBurnBand({ x: 0, y: 70 }, { x: 100, y: 70 }, 12, 13, bounds), { threshold: 0.05 });
  assert.equal(r3.complete, true, '达到阈值应交给引擎整体结算');

  restoreBurn(el);
  assert.equal(el.style.maskImage, '', '撤销必须恢复原 mask');
  clearBurns();
  assert.equal(burnCount(), 0);
});

await check('炮台、光柱与焦边按样式分发且批量绘制', () => {
  const calls = [];
  const ctx = new Proxy({}, {
    get(_t, key) {
      if (key === 'createRadialGradient') return () => ({ addColorStop() {} });
      return () => calls.push(key);
    },
    set() { return true; },
  });
  const t = performance.now();

  drawLaserEmitter(ctx, { active: true, x: 0, y: 0, aimX: 100, aimY: 0, charge: 0.7, recoil: 0.2 }, {});
  assert.ok(calls.filter((k) => k === 'stroke').length >= 2, '炮台应画出底座与蓄力环');

  calls.length = 0;
  const column = {
    from: { x: 0, y: 0 }, to: { x: 600, y: 0 }, width: 18,
    t0: t - 300, durationMs: 900, style: 'column', charge: 1,
  };
  drawLaserColumn(ctx, column, t, { laserStyle: 'column' });
  const colStrokes = calls.filter((k) => k === 'stroke').length;
  assert.ok(colStrokes > 0 && colStrokes <= 8, `光柱应批量绘制，实际 stroke ${colStrokes} 次`);
  assert.equal(
    calls.filter((k) => k === 'save').length,
    calls.filter((k) => k === 'restore').length,
    'canvas 状态必须配对'
  );

  calls.length = 0;
  drawLaserColumn(ctx, column, t, { laserStyle: 'other' });
  assert.equal(calls.length, 0, '未实现的形态不应绘制，预留后续接入');

  calls.length = 0;
  drawBurnEdges(ctx, [{
    heat: 0.8,
    left: [[0, 0], [50, 2], [100, 0]],
    right: [[0, 8], [50, 10], [100, 8]],
  }], t);
  const burnStrokes = calls.filter((k) => k === 'stroke').length;
  assert.ok(burnStrokes >= 6 && burnStrokes <= 10, `焦边应有完整色阶且合并 path，实际 stroke ${burnStrokes} 次`);

  // 焦边宽度必须跟着烧蚀带半宽缩放，而不是固定像素
  const widths = [];
  const ctx2 = new Proxy({}, {
    get(_t, key) {
      if (key === 'createRadialGradient') return () => ({ addColorStop() {} });
      return () => {};
    },
    set(_t, key, value) {
      if (key === 'lineWidth') widths.push(value);
      return true;
    },
  });
  drawBurnEdges(ctx2, [{
    heat: 0.8, half: 20, intensity: 1, nx: 0, ny: 1,
    left: [[0, 20], [80, 20]], right: [[0, -20], [80, -20]],
  }], performance.now());
  assert.ok(widths.includes(20), `最宽层应等于烧蚀半宽，实际宽度 ${widths.join(',')}`);
});

await check('音效槽位与切换枚举', () => {
  for (const key of [
    'laserCharge',
    'laserFire',
    'laserOverFire',
    'laserHit',
    'bladeSwing',
    'bladeFinish',
  ]) {
    assert.ok(SAMPLE_ASSETS[key], `${key} 需登记采样槽位`);
  }
  assert.ok(!SAMPLE_ASSETS.laserBeam, '蓄力嗡鸣需循环播放，不应走一次性采样');
  assert.deepEqual(LASER_SOUND_STYLES, ['synth', 'sample']);
  for (const key of [
    'sfxLaserCharge',
    'sfxLaserFire',
    'sfxLaserOverFire',
    'sfxLaserHit',
    'sfxBladeSwing',
    'sfxBladeFinish',
  ]) {
    assert.equal(DEFAULT_CONFIG[key], 1, `${key} 应有默认音量`);
  }
});

console.log(`\n通过 ${passed} 项，失败 ${failed} 项。`);
if (failed) process.exitCode = 1;
