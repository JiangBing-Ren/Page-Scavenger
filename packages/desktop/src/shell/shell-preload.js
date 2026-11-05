const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  nav: {
    go: (url) => ipcRenderer.send('nav:go', url),
    back: () => ipcRenderer.send('nav:back'),
    reload: () => ipcRenderer.send('nav:reload'),
    home: () => ipcRenderer.send('nav:home'),
    levels: () => ipcRenderer.send('nav:levels'),
  },
  game: {
    toggle: () => ipcRenderer.send('game:toggle'),
    setConfig: (patch) => ipcRenderer.send('game:config', patch),
  },
  ui: {
    setToolbarHeight: (height) => ipcRenderer.send('ui:toolbar-height', height),
    openGuide: () => ipcRenderer.send('ui:open-guide'),
    openConfig: () => ipcRenderer.send('ui:open-config'),
    openExternal: (url) => ipcRenderer.send('ui:open-external', url),
  },
  guide: {
    info: () => ipcRenderer.invoke('guide:info'),
    copyPath: () => ipcRenderer.invoke('guide:copy-path'),
    openFolder: () => ipcRenderer.invoke('guide:open-folder'),
    openExtensionsPage: (browser) => ipcRenderer.invoke('guide:open-extensions', browser),
  },
  config: {
    get: () => ipcRenderer.invoke('config:get'),
    set: (config) => ipcRenderer.invoke('config:set', config),
  },
  // 配置器试听也要放采样音效，file:// 不能 fetch，改走主进程同步读字节
  assets: {
    read: (file) => ipcRenderer.sendSync('asset:read', file),
  },
  on: {
    nav: (cb) => ipcRenderer.on('ui:nav', (_event, patch) => cb(patch)),
    game: (cb) => ipcRenderer.on('ui:game', (_event, state) => cb(state)),
  },
});
