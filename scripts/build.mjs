#!/usr/bin/env node
// 零依赖打包：把 ESM 源码转成扩展可用的 IIFE bundle。
// 支持本工程用到的语法：
//   import { a, b as c } from './x.js';   （可跨行）
//   export const / let / var / function / class / async function NAME
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const toPosix = (p) => p.split(path.sep).join('/');

const IMPORT_RE = /^[ \t]*import\s*\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"]\s*;?[ \t]*$/gm;
const IMPORT_TOKEN_RE = /\/\*__IMPORT_(\d+)__\*\//;
const EXPORT_RE = /^export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z0-9_$]+)/;

const PRELUDE = `(function () {
'use strict';
var __defs = Object.create(null);
var __cache = Object.create(null);
function __def(id, factory) { __defs[id] = factory; }
function __req(id) {
  var cached = __cache[id];
  if (cached) return cached;
  var exportsObj = {};
  __cache[id] = exportsObj;
  var factory = __defs[id];
  if (!factory) throw new Error('module not found: ' + id);
  factory(exportsObj);
  return exportsObj;
}
`;

function formatBindings(raw) {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((spec) => {
      const parts = spec.split(/\s+as\s+/);
      const original = parts[0].trim();
      const local = (parts[1] || parts[0]).trim();
      return original === local ? original : `${original}: ${local}`;
    })
    .join(', ');
}

async function bundle(entryAbs) {
  const modules = new Map();
  const order = [];

  async function load(fileAbs) {
    const id = toPosix(path.relative(ROOT, fileAbs));
    if (modules.has(id)) return id;

    modules.set(id, null);
    order.push(id);

    const raw = await fs.readFile(fileAbs, 'utf8');
    let src = raw.replace(/^\uFEFF/, '');

    const imports = [];
    src = src.replace(IMPORT_RE, (match, names, spec) => {
      imports.push({ names, spec });
      return `/*__IMPORT_${imports.length - 1}__*/`;
    });

    const depIds = [];
    for (const imp of imports) {
      const depAbs = path.resolve(path.dirname(fileAbs), imp.spec);
      depIds.push(await load(depAbs));
    }

    const exported = [];
    const outLines = [];

    for (const line of src.split(/\r?\n/)) {
      const tokenMatch = line.match(IMPORT_TOKEN_RE);
      if (tokenMatch) {
        const i = Number(tokenMatch[1]);
        outLines.push(
          `const { ${formatBindings(imports[i].names)} } = __req(${JSON.stringify(depIds[i])});`
        );
        continue;
      }

      const exp = line.match(EXPORT_RE);
      if (exp) {
        exported.push(exp[1]);
        outLines.push(line.replace(/^export\s+/, ''));
        continue;
      }

      if (/^\s*export\s/.test(line)) {
        throw new Error(`不支持的 export 语法：${fileAbs}\n  ${line.trim()}`);
      }

      outLines.push(line);
    }

    const tail = exported.length
      ? '\n' + exported.map((n) => `__exports[${JSON.stringify(n)}] = ${n};`).join('\n')
      : '';

    modules.set(id, outLines.join('\n') + tail);
    return id;
  }

  const entryId = await load(entryAbs);

  let code = PRELUDE;
  for (const id of order) {
    const body = modules.get(id);
    if (body == null) throw new Error(`模块加载失败（可能存在循环依赖）：${id}`);
    code += `__def(${JSON.stringify(id)}, function (__exports) {\n${body}\n});\n\n`;
  }
  code += `__req(${JSON.stringify(entryId)});\n})();\n`;

  return code;
}

async function writeBundle(entryRel, outRel, banner) {
  const code = await bundle(path.join(ROOT, entryRel));
  const outAbs = path.join(ROOT, outRel);
  await fs.mkdir(path.dirname(outAbs), { recursive: true });
  await fs.writeFile(outAbs, (banner ? banner + '\n' : '') + code, 'utf8');
  return { outRel, bytes: Buffer.byteLength(code) };
}

async function copyFile(fromRel, toRel) {
  const toAbs = path.join(ROOT, toRel);
  await fs.mkdir(path.dirname(toAbs), { recursive: true });
  await fs.copyFile(path.join(ROOT, fromRel), toAbs);
}

async function writeManifest(fromRel, toDir) {
  const raw = await fs.readFile(path.join(ROOT, fromRel), 'utf8');
  const json = JSON.parse(raw);
  await fs.mkdir(path.join(ROOT, toDir), { recursive: true });
  await fs.writeFile(
    path.join(ROOT, toDir, 'manifest.json'),
    JSON.stringify(json, null, 2) + '\n',
    'utf8'
  );
}

async function copyDir(fromRel, toRel) {
  const fromAbs = path.join(ROOT, fromRel);
  const entries = await fs.readdir(fromAbs, { withFileTypes: true });
  for (const e of entries) {
    const rel = `${fromRel}/${e.name}`;
    if (e.isDirectory()) await copyDir(rel, `${toRel}/${e.name}`);
    else await copyFile(rel, `${toRel}/${e.name}`);
  }
}

const HOSTS = [
  { dir: 'dist/extension', manifest: 'packages/extension/manifest.chrome.json' },
  { dir: 'dist/extension-firefox', manifest: 'packages/extension/manifest.firefox.json' },
];

async function main() {
  const { generateIcons } = await import('./make-icons.mjs');
  await generateIcons();

  // 先清空 dist：残留的旧产物会掩盖「引用了不存在的文件」这类问题，
  // 表现为本地能过、CI 干净环境却失败（已经踩过一次）
  await fs.rm(path.join(ROOT, 'dist'), { recursive: true, force: true });

  const results = [];

  for (const host of HOSTS) {
    results.push(await writeBundle('packages/extension/src/content.js', `${host.dir}/content.js`));
    results.push(
      await writeBundle('packages/extension/src/background.js', `${host.dir}/background.js`)
    );
    results.push(
      await writeBundle('packages/extension/src/popup/popup.js', `${host.dir}/popup/popup.js`)
    );
    results.push(
      await writeBundle('packages/play/src/runner.js', `${host.dir}/play/levels/runner.js`)
    );
    results.push(
      await writeBundle('packages/play/src/tutorial.js', `${host.dir}/play/levels/tutorial.js`)
    );
    results.push(
      await writeBundle('packages/configurator/src/config.js', `${host.dir}/config/config.js`)
    );

    await copyFile('packages/extension/src/popup/popup.html', `${host.dir}/popup/popup.html`);
    await copyFile('packages/extension/src/popup/popup.css', `${host.dir}/popup/popup.css`);
    await copyDir('packages/play/levels', `${host.dir}/play/levels`);
    // 只拷贝静态文件，config.js 用打包产物，不能用源码覆盖
    await copyFile('packages/configurator/src/index.html', `${host.dir}/config/index.html`);
    await copyFile('packages/configurator/src/style.css', `${host.dir}/config/style.css`);
    await copyDir('packages/extension/icons', `${host.dir}/icons`);
    await writeManifest(host.manifest, host.dir);
  }

  const banner = await fs.readFile(path.join(ROOT, 'packages/userscript/src/banner.txt'), 'utf8');
  results.push(
    await writeBundle('packages/userscript/src/index.js', 'dist/页面清道夫.user.js', banner)
  );

  // 桌面版
  results.push(
    await writeBundle('packages/desktop/src/page-preload.js', 'dist/desktop/page-preload.js')
  );
  results.push(
    await writeBundle(
      'packages/desktop/src/shell/shell-preload.js',
      'dist/desktop/shell/shell-preload.js'
    )
  );
  results.push(
    await writeBundle('packages/desktop/src/shell/shell.js', 'dist/desktop/shell/shell.js')
  );
  results.push(
    await writeBundle('packages/desktop/src/shell/guide.js', 'dist/desktop/shell/guide.js')
  );

  for (const file of ['shell.html', 'shell.css', 'welcome.html', 'guide.html']) {
    await copyFile(`packages/desktop/src/shell/${file}`, `dist/desktop/shell/${file}`);
  }

  // 桌面版也带关卡（与扩展共用同一份关卡内容）
  results.push(
    await writeBundle('packages/play/src/runner.js', 'dist/desktop/play/levels/runner.js')
  );
  results.push(
    await writeBundle('packages/play/src/tutorial.js', 'dist/desktop/play/levels/tutorial.js')
  );
  await copyDir('packages/play/levels', 'dist/desktop/play/levels');

  // 桌面版配置器
  results.push(
    await writeBundle('packages/configurator/src/config.js', 'dist/desktop/config/config.js')
  );
  await copyFile('packages/configurator/src/index.html', 'dist/desktop/config/index.html');
  await copyFile('packages/configurator/src/style.css', 'dist/desktop/config/style.css');

  for (const r of results) {
    console.log(`  ${String(r.bytes).padStart(7)} B  ${r.outRel}`);
  }
  console.log('\n打包完成。');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
