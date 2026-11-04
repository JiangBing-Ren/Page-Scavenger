const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const {
  app,
  BrowserWindow,
  WebContentsView,
  ipcMain,
  clipboard,
  shell,
  Menu,
} = require('electron');

const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';

const REPO_DIST = path.join(__dirname, '..', '..', '..', 'dist');

function assetsDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'desktop')
    : path.join(REPO_DIST, 'desktop');
}

function extensionDirs() {
  const base = app.isPackaged ? process.resourcesPath : REPO_DIST;
  return {
    chromium: path.join(base, 'extension'),
    firefox: path.join(base, 'extension-firefox'),
  };
}

let settings = { config: {} };

function settingsFile() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function loadSettings() {
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
    if (parsed && typeof parsed === 'object') settings = { config: parsed.config || {} };
  } catch (e) {}
}

function saveSettings() {
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2), 'utf8');
  } catch (e) {}
}

let win = null;
let view = null;
let guideWin = null;
let configWin = null;
let toolbarHeight = 96;
let lastGameState = { active: false, config: {} };

function sendNav(patch) {
  if (!win || win.isDestroyed()) return;
  win.webContents.send('ui:nav', patch);
}

function sendGame() {
  if (!win || win.isDestroyed()) return;
  win.webContents.send('ui:game', lastGameState);
}

function pushConfig() {
  if (!view || view.webContents.isDestroyed()) return;
  view.webContents.send('adslash:config', settings.config || {});
}

function layoutView() {
  if (!win || !view || win.isDestroyed()) return;
  const [width, height] = win.getContentSize();
  view.setBounds({
    x: 0,
    y: toolbarHeight,
    width,
    height: Math.max(0, height - toolbarHeight),
  });
}

function normalizeUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) return 'about:blank';
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return raw;
  if (/^(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(raw)) return 'http://' + raw;
  if (/^[^\s/]+\.[^\s/]+/.test(raw)) return 'https://' + raw;
  return 'https://www.bing.com/search?q=' + encodeURIComponent(raw);
}

function go(url) {
  if (!view || view.webContents.isDestroyed()) return;
  view.webContents.loadURL(normalizeUrl(url)).catch(() => {});
}

function loadWelcome() {
  if (!view || view.webContents.isDestroyed()) return;
  view.webContents
    .loadFile(path.join(assetsDir(), 'shell', 'welcome.html'))
    .catch(() => {});
}

function createWindow() {
  Menu.setApplicationMenu(null);

  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#0d1016',
    title: '页面清道夫',
    show: false,
    webPreferences: {
      preload: path.join(assetsDir(), 'shell', 'shell-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(assetsDir(), 'shell', 'shell.html'));

  view = new WebContentsView({
    webPreferences: {
      preload: path.join(assetsDir(), 'page-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      // 游戏特效不应因窗口失焦被浏览器节流
      backgroundThrottling: false,
    },
  });
  win.contentView.addChildView(view);

  const wc = view.webContents;

  wc.on('did-start-loading', () => sendNav({ loading: true, error: '' }));
  wc.on('did-stop-loading', () =>
    sendNav({ loading: false, url: wc.getURL(), title: wc.getTitle() })
  );
  wc.on('page-title-updated', (_e, title) => sendNav({ title }));
  wc.on('did-fail-load', (_e, code, desc, _url, isMainFrame) => {
    if (isMainFrame && code !== -3) sendNav({ error: `${desc}（${code}）` });
  });
  wc.on('did-finish-load', () => pushConfig());

  // Alt+S 在页面内直接开关，和扩展的快捷键保持一致
  wc.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || !input.alt || input.control || input.meta) return;
    const key = String(input.key || '').toLowerCase();
    if (key !== 's') return;
    event.preventDefault();
    wc.send('adslash:cmd', 'toggle');
  });

  // 站内新窗口统一在当前视图打开，避免弹出无注入的裸窗口
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) wc.loadURL(url).catch(() => {});
    return { action: 'deny' };
  });

  win.on('resize', layoutView);
  layoutView();
  loadWelcome();

  // 开发自检：ADSLASH_SELFTEST=1 时自动激活并检查注入链路；
  // 配合 ADSLASH_SELFTEST_LEVEL=关卡名，还会模拟一次真实划动验证计分。
  if (process.env.ADSLASH_SELFTEST === '1') {
    const level = process.env.ADSLASH_SELFTEST_LEVEL || '';
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    if (level) {
      wc.loadFile(path.join(assetsDir(), 'play', 'levels', level + '.html')).catch(() => {});
    }

    wc.once('did-finish-load', async () => {
      wc.send('adslash:cmd', 'activate');
      await sleep(1200);

      try {
        const base = await wc.executeJavaScript(
          '(() => {' +
            ' const canvasCount = document.querySelectorAll("canvas[data-adslash-ui]").length;' +
            ' const hud = document.getElementById("cleaner-hud");' +
            ' const targets = document.querySelectorAll("[data-target]").length;' +
            ' const free = document.getElementById("cleaner-free-score");' +
            ' return JSON.stringify({ canvasCount, hud: !!hud, targets, free: !!free, freeOn: !!(free && free.classList.contains("on")) });' +
            '})()'
        );
        console.log('[selftest] ' + base);

        if (level) {
          const box = await wc.executeJavaScript(
            '(() => {' +
              ' const t = document.querySelector("[data-target]");' +
              ' const r = t.getBoundingClientRect();' +
              ' return JSON.stringify({ cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width });' +
              '})()'
          );
          const { cx, cy, w } = JSON.parse(box);
          const y = Math.round(cy);
          const x0 = Math.round(cx - w / 2 - 12);
          const x1 = Math.round(cx + w / 2 + 12);

          // sendInputEvent 在窗口未持续绘制时会被合并成 1~2 个 move，
          // 这里直接在页面内合成 PointerEvent，验证「引擎 → 计分」链路
          await wc.executeJavaScript(
            '(() => {' +
              ' const canvas = document.querySelector("canvas[data-adslash-ui]");' +
              ' if (!canvas) return "no-canvas";' +
              ' const fire = (type, x, yy) => canvas.dispatchEvent(new PointerEvent(type, {' +
              '   bubbles: true, cancelable: true, clientX: x, clientY: yy,' +
              '   button: 0, buttons: type === "pointerup" ? 0 : 1, pointerType: "mouse" }));' +
              ` const x0 = ${x0}, x1 = ${x1}, y = ${y};` +
              ` const cx = ${Math.round(cx)};` +
              ' fire("pointermove", x0, y);' +
              ' fire("pointerdown", x0, y);' +
              ' for (let x = x0; x <= cx; x += 6) fire("pointermove", x, y);' +
              ' return "half";' +
              '})()'
          );

          console.log(
            '[selftest] mid-drag ' +
              (await wc.executeJavaScript(
                'JSON.stringify((() => {' +
                  ` const cx = ${Math.round(cx)}, cy = ${Math.round(cy)};` +
                  ' const hit = document.elementFromPoint(cx, cy);' +
                  ' const t = document.querySelector("[data-target]");' +
                  ' const r = t.getBoundingClientRect();' +
                  ' return {' +
                  '   debug: window.__levelDebug ? window.__levelDebug() : null,' +
                  '   tagAtCenter: hit ? hit.tagName + "." + (hit.className || "") : "none",' +
                  '   stack: document.elementsFromPoint(cx, cy).slice(0, 6).map((n) => n.tagName + "." + (n.className || "")),' +
                  '   targetRect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],' +
                  '   targetTag: t.tagName + "." + (t.className || ""),' +
                  ' };' +
                  '})())'
              ))
          );

          await wc.executeJavaScript(
            '(() => {' +
              ' const canvas = document.querySelector("canvas[data-adslash-ui]");' +
              ' const fire = (type, x, yy) => canvas.dispatchEvent(new PointerEvent(type, {' +
              '   bubbles: true, cancelable: true, clientX: x, clientY: yy,' +
              '   button: 0, buttons: type === "pointerup" ? 0 : 1, pointerType: "mouse" }));' +
              ` const x0 = ${x0}, x1 = ${x1}, y = ${y}, cx = ${Math.round(cx)};` +
              ' for (const yy of [y - 20, y, y + 20]) {' +
              '   fire("pointermove", x0, yy);' +
              '   for (let x = x0; x <= x1; x += 6) fire("pointermove", x, yy);' +
              ' }' +
              ' return "moved";' +
              '})()'
          );

          console.log(
            '[selftest] before-release ' +
              (await wc.executeJavaScript(
                'JSON.stringify(window.__levelDebug ? window.__levelDebug() : null)'
              ))
          );

          await wc.executeJavaScript(
            '(() => {' +
              ' const canvas = document.querySelector("canvas[data-adslash-ui]");' +
              ` canvas.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, clientX: ${x1}, clientY: ${y}, button: 0, buttons: 0, pointerType: "mouse" }));` +
              ' return "released";' +
              '})()'
          );

          // 逐刀序列 + 抬升过渡 + 炸开，总共约 700ms，这里留足时间
          await sleep(1100);
          const snap = async () =>
            wc.executeJavaScript(
              '(() => {' +
                ' const frags = Array.from(document.querySelectorAll("[data-adslash-ui]")).filter((n) => n.style.clipPath);' +
                ' const hud = document.getElementById("cleaner-hud");' +
                ' const q = (k) => (hud ? hud.querySelector("[data-k=" + k + "]").textContent : "n/a");' +
                ' return JSON.stringify({ score: q("score"), combo: q("combo"), remain: q("remain"), frags: frags.length });' +
                '})()'
            );

          console.log('[selftest] after-slash ' + (await snap()));

          // 第二次同向划动：碎片此刻仍在原位附近，应当被再切
          await wc.executeJavaScript(
            '(() => {' +
              ' const canvas = document.querySelector("canvas[data-adslash-ui]");' +
              ' if (!canvas) return "no-canvas";' +
              ' const fire = (type, x, yy) => canvas.dispatchEvent(new PointerEvent(type, {' +
              '   bubbles: true, cancelable: true, clientX: x, clientY: yy,' +
              '   button: 0, buttons: type === "pointerup" ? 0 : 1, pointerType: "mouse" }));' +
              ` const x0 = ${x0}, x1 = ${x1}, y = ${y};` +
              ' fire("pointermove", x0, y);' +
              ' fire("pointerdown", x0, y);' +
              ' for (let x = x0; x <= x1; x += 6) fire("pointermove", x, y);' +
              ' fire("pointerup", x1, y);' +
              ' return "fired";' +
              '})()'
          );

          await sleep(300);
          console.log('[selftest] after-combo-cut ' + (await snap()));
        }
      } catch (e) {
        console.log('[selftest] error=' + e.message);
      }

      app.quit();
    });
  }
}

function openConfig() {
  if (configWin && !configWin.isDestroyed()) {
    configWin.focus();
    return;
  }

  configWin = new BrowserWindow({
    width: 940,
    height: 820,
    minWidth: 720,
    minHeight: 560,
    backgroundColor: '#0d1016',
    title: '页面清道夫 · 配置',
    parent: win || undefined,
    webPreferences: {
      preload: path.join(assetsDir(), 'shell', 'shell-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  configWin.loadFile(path.join(assetsDir(), 'config', 'index.html'));
  configWin.on('closed', () => {
    configWin = null;
  });
}

function openGuide() {
  if (guideWin && !guideWin.isDestroyed()) {
    guideWin.focus();
    return;
  }

  guideWin = new BrowserWindow({
    width: 900,
    height: 780,
    minWidth: 720,
    minHeight: 560,
    backgroundColor: '#0d1016',
    title: '装到你自己的浏览器',
    parent: win || undefined,
    webPreferences: {
      preload: path.join(assetsDir(), 'shell', 'shell-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  guideWin.loadFile(path.join(assetsDir(), 'shell', 'guide.html'));
  guideWin.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  guideWin.on('closed', () => {
    guideWin = null;
  });
}

function exists(p) {
  try {
    return !!p && fs.existsSync(p);
  } catch (e) {
    return false;
  }
}

function detectBrowsers() {
  const found = [];
  const env = process.env;

  if (isWin) {
    const defs = [
      {
        id: 'chrome',
        name: 'Google Chrome',
        kind: 'chromium',
        paths: [
          path.join(env.PROGRAMFILES || 'C:\\Program Files', 'Google\\Chrome\\Application\\chrome.exe'),
          path.join(env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google\\Chrome\\Application\\chrome.exe'),
          path.join(env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
        ],
      },
      {
        id: 'edge',
        name: 'Microsoft Edge',
        kind: 'chromium',
        paths: [
          path.join(env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Microsoft\\Edge\\Application\\msedge.exe'),
          path.join(env.PROGRAMFILES || 'C:\\Program Files', 'Microsoft\\Edge\\Application\\msedge.exe'),
        ],
      },
      {
        id: 'brave',
        name: 'Brave',
        kind: 'chromium',
        paths: [
          path.join(env.PROGRAMFILES || 'C:\\Program Files', 'BraveSoftware\\Brave-Browser\\Application\\brave.exe'),
          path.join(env.LOCALAPPDATA || '', 'BraveSoftware\\Brave-Browser\\Application\\brave.exe'),
        ],
      },
      {
        id: 'vivaldi',
        name: 'Vivaldi',
        kind: 'chromium',
        paths: [
          path.join(env.LOCALAPPDATA || '', 'Vivaldi\\Application\\vivaldi.exe'),
          path.join(env.PROGRAMFILES || 'C:\\Program Files', 'Vivaldi\\Application\\vivaldi.exe'),
        ],
      },
      {
        id: 'opera',
        name: 'Opera',
        kind: 'chromium',
        paths: [
          path.join(env.LOCALAPPDATA || '', 'Programs\\Opera\\opera.exe'),
          path.join(env.APPDATA || '', 'Opera\\Opera\\opera.exe'),
        ],
      },
      {
        id: 'firefox',
        name: 'Mozilla Firefox',
        kind: 'firefox',
        paths: [
          path.join(env.PROGRAMFILES || 'C:\\Program Files', 'Mozilla Firefox\\firefox.exe'),
          path.join(env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Mozilla Firefox\\firefox.exe'),
        ],
      },
    ];

    for (const def of defs) {
      const exe = def.paths.find(exists);
      if (exe) found.push({ id: def.id, name: def.name, kind: def.kind, exe });
    }
  } else if (isMac) {
    const defs = [
      { id: 'chrome', name: 'Google Chrome', kind: 'chromium', appName: 'Google Chrome' },
      { id: 'edge', name: 'Microsoft Edge', kind: 'chromium', appName: 'Microsoft Edge' },
      { id: 'brave', name: 'Brave', kind: 'chromium', appName: 'Brave Browser' },
      { id: 'opera', name: 'Opera', kind: 'chromium', appName: 'Opera' },
      { id: 'vivaldi', name: 'Vivaldi', kind: 'chromium', appName: 'Vivaldi' },
      { id: 'firefox', name: 'Mozilla Firefox', kind: 'firefox', appName: 'Firefox' },
    ];

    for (const def of defs) {
      const appPath = `/Applications/${def.appName}.app`;
      if (exists(appPath)) {
        found.push({ id: def.id, name: def.name, kind: def.kind, appName: def.appName });
      }
    }
  }

  return found;
}

function openExtensionsPage(browser) {
  if (!browser) return;
  const url =
    browser.kind === 'firefox' ? 'about:debugging#/runtime/this-firefox' : 'chrome://extensions';

  try {
    if (isMac) {
      spawn('open', ['-a', browser.appName, url], { detached: true, stdio: 'ignore' }).unref();
    } else if (browser.exe) {
      spawn(browser.exe, [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch (e) {}
}

ipcMain.on('ui:toolbar-height', (_e, height) => {
  const value = Math.round(Number(height) || 0);
  if (!Number.isFinite(value)) return;
  toolbarHeight = Math.max(40, Math.min(400, value));
  layoutView();
});

ipcMain.on('nav:go', (_e, url) => go(url));

ipcMain.on('nav:back', () => {
  if (!view || view.webContents.isDestroyed()) return;
  const history = view.webContents.navigationHistory;
  if (history && history.canGoBack()) history.goBack();
});

ipcMain.on('nav:reload', () => {
  if (view && !view.webContents.isDestroyed()) view.webContents.reload();
});

ipcMain.on('nav:home', () => loadWelcome());

ipcMain.on('nav:levels', () => {
  if (!view || view.webContents.isDestroyed()) return;
  view.webContents.loadFile(path.join(assetsDir(), 'play', 'levels', 'index.html')).catch(() => {});
});

ipcMain.on('game:toggle', () => {
  if (view && !view.webContents.isDestroyed()) view.webContents.send('adslash:cmd', 'toggle');
});

ipcMain.on('game:config', (_e, patch) => {
  if (!patch || typeof patch !== 'object') return;
  settings.config = Object.assign({}, settings.config, patch);
  saveSettings();
  pushConfig();
});

ipcMain.on('adslash:state', (_e, state) => {
  if (!state || typeof state !== 'object') return;
  lastGameState = state;
  sendGame();
});

ipcMain.on('ui:open-guide', () => openGuide());

ipcMain.on('ui:open-config', () => openConfig());

ipcMain.handle('config:get', () => settings.config || {});

ipcMain.handle('config:set', (_e, config) => {
  if (!config || typeof config !== 'object') return false;
  settings.config = { ...config };
  saveSettings();
  pushConfig();
  return true;
});

ipcMain.on('ui:open-external', (_e, url) => {
  const target = String(url || '');
  if (/^https?:/i.test(target)) shell.openExternal(target);
});

ipcMain.handle('guide:info', () => {
  const dirs = extensionDirs();
  return {
    browsers: detectBrowsers(),
    chromiumPath: dirs.chromium,
    firefoxPath: dirs.firefox,
    packaged: app.isPackaged,
    platform: process.platform,
  };
});

function allowedDir(dir) {
  const dirs = extensionDirs();
  if (dir === dirs.chromium) return dirs.chromium;
  if (dir === dirs.firefox) return dirs.firefox;
  return null;
}

ipcMain.handle('guide:copy-path', (_e, dir) => {
  const target = allowedDir(dir);
  if (!target) return false;
  clipboard.writeText(target);
  return true;
});

ipcMain.handle('guide:open-folder', async (_e, dir) => {
  const target = allowedDir(dir);
  if (!target || !exists(target)) return false;
  const manifest = path.join(target, 'manifest.json');
  if (exists(manifest)) shell.showItemInFolder(manifest);
  else shell.openPath(target);
  return true;
});

ipcMain.handle('guide:open-extensions', (_e, browser) => {
  openExtensionsPage(browser);
  return true;
});

app.whenReady().then(() => {
  // 去掉 UA 里的 Electron / 应用标识，避免站点把它当自动化客户端
  app.userAgentFallback = app.userAgentFallback
    .replace(/\sElectron\/[\d.]+/i, '')
    .replace(/\spage-cleaner-desktop\/[\d.]+/i, '');

  loadSettings();
  createWindow();

  // 开发自检：只打开配置器，检查表单渲染
  if (process.env.ADSLASH_OPEN_CONFIG === '1') {
    openConfig();
    setTimeout(async () => {
      try {
        const report = await configWin.webContents.executeJavaScript(
          'JSON.stringify({' +
            ' fields: document.querySelectorAll(".field").length,' +
            ' toggles: document.querySelectorAll(".field[data-kind=toggle]").length,' +
            ' ranges: document.querySelectorAll(".field[data-kind=range]").length,' +
            ' host: (document.getElementById("host") || {}).textContent || "",' +
            ' save: !!document.getElementById("save")' +
            '})'
        );
        console.log('[config-test] ' + report);
      } catch (e) {
        console.log('[config-test] error=' + e.message);
      }
      app.quit();
    }, 1500);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});
