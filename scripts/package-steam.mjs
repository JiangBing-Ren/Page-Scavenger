#!/usr/bin/env node
// 把当前版本打成 Steam 可上传的绿色目录：dist/steam-demo/
//
// 不引入 electron-builder，直接用 Electron 自带运行时 + resources/app 的方式组装，
// 保持构建链零依赖。产物是「解压即运行」的文件夹，Steamworks 直接按 depot 上传即可。
//
// 用法：
//   node scripts/build.mjs && node scripts/package-steam.mjs
//   STEAM_APP_ID=1234567 node scripts/package-steam.mjs   # 换成自己的 AppID
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'dist', 'steam-demo');
const RUNTIME = path.join(ROOT, 'node_modules', 'electron', 'dist');
const APP_NAME = 'PageScavenger';
// 480 是 Valve 的 Spacewar 测试应用；正式上架演示版前换成自己的 AppID
const APP_ID = process.env.STEAM_APP_ID || '480';

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch (e) {
    return false;
  }
}

async function copyDir(from, to) {
  await fs.mkdir(to, { recursive: true });
  const entries = await fs.readdir(from, { withFileTypes: true });
  for (const entry of entries) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) await copyDir(src, dst);
    else if (entry.isSymbolicLink()) await fs.symlink(await fs.readlink(src), dst);
    else await fs.copyFile(src, dst);
  }
}

async function dirSize(dir) {
  let total = 0;
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) total += await dirSize(p);
    else if (entry.isFile()) total += (await fs.stat(p)).size;
  }
  return total;
}

async function main() {
  if (!(await exists(RUNTIME))) {
    console.error('找不到 Electron 运行时：' + RUNTIME);
    console.error('先执行 npm install，再按 README 的说明确认 dist 目录已下载。');
    process.exit(1);
  }

  const built = ['desktop', 'extension', 'extension-firefox'].map((name) =>
    path.join(ROOT, 'dist', name)
  );
  for (const dir of built) {
    if (!(await exists(dir))) {
      console.error('缺少构建产物：' + dir + '，先执行 node scripts/build.mjs');
      process.exit(1);
    }
  }

  console.log('==> 清理输出目录');
  await fs.rm(OUT, { recursive: true, force: true });
  await fs.mkdir(OUT, { recursive: true });

  console.log('==> 复制 Electron 运行时（约 300MB，稍等）');
  await copyDir(RUNTIME, OUT);
  await fs.rm(path.join(OUT, 'resources', 'default_app.asar'), { force: true });

  const exe = path.join(OUT, 'electron.exe');
  if (await exists(exe)) await fs.rename(exe, path.join(OUT, APP_NAME + '.exe'));

  console.log('==> 组装应用');
  const pkg = JSON.parse(await fs.readFile(path.join(ROOT, 'package.json'), 'utf8'));
  const appDir = path.join(OUT, 'resources', 'app');
  const appSrc = path.join(appDir, 'packages', 'desktop', 'src');
  await fs.mkdir(appSrc, { recursive: true });
  await fs.copyFile(
    path.join(ROOT, 'packages', 'desktop', 'src', 'main.js'),
    path.join(appSrc, 'main.js')
  );
  await fs.writeFile(
    path.join(appDir, 'package.json'),
    JSON.stringify(
      {
        name: 'page-scavenger',
        productName: '页面清道夫',
        version: pkg.version,
        main: 'packages/desktop/src/main.js',
      },
      null,
      2
    ) + '\n',
    'utf8'
  );

  // main.js 在打包态从 resourcesPath 找 desktop / extension
  await copyDir(path.join(ROOT, 'dist', 'desktop'), path.join(OUT, 'resources', 'desktop'));
  await copyDir(path.join(ROOT, 'dist', 'extension'), path.join(OUT, 'resources', 'extension'));
  await copyDir(
    path.join(ROOT, 'dist', 'extension-firefox'),
    path.join(OUT, 'resources', 'extension-firefox')
  );

  console.log('==> Steam 入口文件');
  await fs.writeFile(path.join(OUT, 'steam_appid.txt'), APP_ID + '\n', 'utf8');
  await fs.writeFile(
    path.join(OUT, 'README-Steam.txt'),
    [
      '页面清道夫 · Steam 演示版',
      '',
      '启动：双击 ' + APP_NAME + '.exe',
      '快捷键：Alt+S 开关斩击，Esc 退出斩击；右键可切换武器。',
      '',
      'steam_appid.txt 里的 ' + APP_ID + ' 是占位值（Valve 的 Spacewar 测试应用）。',
      '上传到 Steamworks 前请填自己的 AppID，或直接删除该文件——Steam 客户端启动时会自动注入。',
      '',
      '目录说明：',
      '  resources/desktop/      内置浏览器、配置页、关卡与音效采样',
      '  resources/extension/    可导出的 Chromium 扩展（用于「装到我的浏览器」）',
      '  resources/extension-firefox/  Firefox 版扩展',
      '  resources/app/          应用入口与主进程代码',
      '',
    ].join('\n'),
    'utf8'
  );

  const bytes = await dirSize(OUT);
  console.log('==> 完成：' + path.relative(ROOT, OUT));
  console.log('    体积 ' + (bytes / 1024 / 1024).toFixed(1) + ' MB（解压后）');
  console.log('    上传：Steamworks → SteamPipe → 以本目录作为 depot 内容根目录');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
