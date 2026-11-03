#!/usr/bin/env node
// 静态与逻辑校验：纯函数正确性 + 打包产物可加载并跑通渲染帧 + manifest 合法性
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import { getSplitPolygons, polygonArea } from '../packages/core/src/geometry.js';
import { DEFAULT_CONFIG, SIZE_LEVELS, HIT_STOPS } from '../packages/core/src/config.js';

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

console.log('\n[2] 手感参数锁定');

await check('关键数值与 v0.4.0 调优结果一致', () => {
  assert.equal(DEFAULT_CONFIG.trailLength, 25);
  assert.equal(DEFAULT_CONFIG.trailLifeMs, 160);
  assert.equal(DEFAULT_CONFIG.sampleStep, 4);
  assert.equal(DEFAULT_CONFIG.pierceRatio, 0.6);
  assert.equal(DEFAULT_CONFIG.hitStop, 40);
  assert.equal(DEFAULT_CONFIG.maxTargetRatio, 0.85);
  assert.equal(DEFAULT_CONFIG.maxAncestorDepth, 15);
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

console.log(`\n通过 ${passed} 项，失败 ${failed} 项。`);
if (failed) process.exitCode = 1;
