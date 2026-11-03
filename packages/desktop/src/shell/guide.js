const $ = (id) => document.getElementById(id);
const api = window.desktop;

const CHROMIUM_STEPS = [
  '点右侧按钮打开 <b>扩展管理页</b>',
  '打开右上角「开发者模式」',
  '点「加载已解压的扩展程序」',
  '选中下面这个扩展目录',
];

const FIREFOX_STEPS = [
  '点右侧按钮打开 <b>about:debugging</b>',
  '点「临时载入附加组件」',
  '选择扩展目录里的 <b>manifest.json</b>',
  '重启浏览器后需要重新载入（Firefox 对未签名扩展的限制）',
];

function makeCard(browser, path) {
  const li = document.createElement('li');

  const head = document.createElement('div');
  head.className = 'b-head';

  const name = document.createElement('span');
  name.className = 'b-name';
  name.textContent = browser.name;

  const tag = document.createElement('span');
  tag.className = 'tag';
  tag.textContent = browser.kind === 'firefox' ? 'Firefox' : 'Chromium';

  const openBtn = document.createElement('button');
  openBtn.type = 'button';
  openBtn.textContent = '打开扩展页';
  openBtn.addEventListener('click', () => api.guide.openExtensionsPage(browser));

  head.append(name, tag, openBtn);

  const steps = document.createElement('ol');
  const list = browser.kind === 'firefox' ? FIREFOX_STEPS : CHROMIUM_STEPS;
  for (const text of list) {
    const item = document.createElement('li');
    item.innerHTML = text;
    steps.appendChild(item);
  }

  const row = document.createElement('div');
  row.className = 'path-row';

  const code = document.createElement('code');
  code.className = 'path';
  code.textContent = path;
  code.title = path;

  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.textContent = '复制';
  copyBtn.addEventListener('click', async () => {
    await api.guide.copyPath(path);
    copyBtn.textContent = '已复制';
    setTimeout(() => (copyBtn.textContent = '复制'), 1200);
  });

  const folderBtn = document.createElement('button');
  folderBtn.type = 'button';
  folderBtn.textContent = '打开目录';
  folderBtn.addEventListener('click', () => api.guide.openFolder(path));

  row.append(code, copyBtn, folderBtn);
  li.append(head, steps, row);
  return li;
}

async function init() {
  const info = await api.guide.info();
  const container = $('browsers');
  container.innerHTML = '';

  if (!info.browsers.length) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = '没有检测到已安装的浏览器。请先安装 Chrome / Edge / Firefox 等，再回到这里。';
    container.appendChild(empty);
    return;
  }

  for (const browser of info.browsers) {
    const path = browser.kind === 'firefox' ? info.firefoxPath : info.chromiumPath;
    container.appendChild(makeCard(browser, path));
  }
}

init();
