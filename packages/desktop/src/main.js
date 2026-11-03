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

  // 开发自检：ADSLASH_SELFTEST=1 时自动激活并检查 canvas，用于无头环境验证注入链路
  if (process.env.ADSLASH_SELFTEST === '1') {
    wc.once('did-finish-load', () => {
      wc.send('adslash:cmd', 'activate');
      setTimeout(async () => {
        try {
          const result = await wc.executeJavaScript(
            '(() => { const c = document.querySelector("canvas[data-adslash-ui]"); return c ? c.width + "x" + c.height : "none"; })()'
          );
          console.log('[selftest] canvas=' + result);
        } catch (e) {
          console.log('[selftest] error=' + e.message);
        }
        app.quit();
      }, 1500);
    });
  }
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

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});
