# 页面清道夫 · Ad Slash

按住鼠标左键划过网页元素，刀光所至直接斩断：高亮框锁定 → 留痕切线 → 对半分离 → 碎片坠落。

不是一个"点一下删除"的屏蔽按钮，而是把清理网页做成一次有手感的斩击。

- 浏览器扩展：Chromium（Chrome / Edge / Brave / Opera / Vivaldi）与 Firefox
- 油猴脚本：`dist/页面清道夫.user.js`
- 手感参数经过长期手动调优，并由测试脚本锁定，防止无意改动

## 安装

### Chromium（Chrome / Edge / Brave / Opera）

1. 打开扩展管理页（Chrome 为 `chrome://extensions`）
2. 打开右上角「开发者模式」
3. 点「加载已解压的扩展程序」，选择 `dist/extension` 目录
4. 首次加载会自动打开教程关

### Firefox

1. 打开 `about:debugging#/runtime/this-firefox`
2. 点「临时载入附加组件」，选择 `dist/extension-firefox/manifest.json`

> Firefox 的临时载入在重启后失效。要长期使用需从 AMO 安装签名版本（尚未发布）。

### 油猴

把 `dist/页面清道夫.user.js` 拖进 Tampermonkey 即可。

## 使用

| 操作 | 说明 |
| --- | --- |
| 点工具栏图标 | 打开设置面板，可开关斩击 |
| `Alt+S` | 在当前页快速开关斩击 |
| 页面右键 | 「页面清道夫：开启 / 关闭斩击」 |
| 按住左键划动 | 斩击；贯穿目标（从一侧进、另一侧出）才判定命中 |
| `Esc` / 右上角 × | 退出斩击模式 |

### 自由模式计分

任意网页开启斩击后，左下角会出现计分条：按被切元素面积给分（10 / 20 / 40 / 80），900ms 内连续命中累加连击（最高 3 倍），退出斩击即重置。

自由模式**不判断对错**——切到正文也不扣分。原因是任意网页上无法可靠区分"该切"和"不该切"，任何判断都会产生明显误伤。需要策略性时用预置关卡。

### 关卡


扩展弹窗点「打开关卡」，桌面版工具栏点「关卡」。目前三关：教程关、广告一条街、卡片丛林。


- 目标用 `data-target` 声明，禁区用 `data-decoy`（切到扣分并断连击）

- 关卡页会给引擎设置 `targetSelector="[data-target],[data-decoy]"`，只切这两类元素，**不受尺寸挡位限制**——否则满宽广告条会被 45% 的挡位上限拒绝

- 一刀切中容器时，容器内部的目标全部计分（`自动抓大` 因此是双刃剑）

- 计分：面积分档 10/20/40/80；连击 ×(1 + 0.25×(n−1))，上限 3 倍；禁区每个 −25；通关按剩余时间每秒 +2

- 评级阈值由关卡自行声明（`data-grade-s / a / b`）


### 设置项


- **尺寸挡位**：自动（向上找最大容器）/ 平衡 / 大 / 中 / 小
- **顿感强度**：无 / 极短 20ms / 短 40ms / 中 80ms / 长 120ms
- **松手再切除**：只留切线不立即切断，松开左键后依次落下
- **自由切割**：不限于广告选择器，任意元素都可切
- **刷新后自动清理**：记住切过的元素，再次访问同域名时自动隐藏

## 桌面版（开发中）

`packages/desktop` 是一个 Electron 外壳：**内置浏览器直接用同一份引擎玩**，并附带一个「装到你自己的浏览器」导览。

```bash
npm install      # 仅首次；Electron 二进制约 250MB
npm run build
npm run desktop
```

- **内置浏览器**：`WebContentsView` 承载页面，`page-preload` 注入 `packages/core`，与扩展共用同一套手感
- **安装导览**：自动探测本机 Chrome / Edge / Brave / Vivaldi / Opera / Firefox，给出逐步操作，可直接打开对应浏览器的扩展管理页并复制扩展目录
- **快捷键**：`Alt+S` 开关斩击，`Esc` 退出
- **自检**：`ADSLASH_SELFTEST=1 npm run desktop` 会自动激活并把 canvas 尺寸打到 stdout，用于验证注入链路

国内网络访问 npm 官方源很慢，可在仓库根目录放一个 `.npmrc`（已被 `.gitignore` 排除）指定镜像：

```ini
registry=https://registry.npmmirror.com
electron_mirror=https://npmmirror.com/mirrors/electron/
```

打包与 Steam 集成尚未配置。

## 从源码构建

只需要 Node.js（无需 npm 安装任何依赖，构建链零第三方依赖）：

```bash
node scripts/build.mjs   # 生成 dist/
node scripts/test.mjs    # 校验几何、参数、产物、manifest
```

产物：

| 路径 | 内容 |
| --- | --- |
| `dist/extension/` | Chromium 扩展（加载已解压） |
| `dist/extension-firefox/` | Firefox 扩展 |
| `dist/页面清道夫.user.js` | 油猴脚本 |

## 目录结构

```
packages/
  core/          宿主无关的斩击引擎（不含任何 chrome.* 调用）
    config.js      手感与判定参数
    selector.js    CSS 路径生成
    targeting.js   目标判定与挡位搜索
    geometry.js    刀线切分（多边形裁剪）
    fragments.js   碎片克隆、分离、火花
    render.js      刀光、高亮框、粒子、退出按钮
    engine.js      状态机、指针事件、渲染循环
  extension/     MV3 扩展外壳
  userscript/    油猴适配层（复用同一份 core）
  play/          关卡与评分：运行时（HUD/计时/结算）+ 关卡页面
  desktop/       桌面版：Electron 内置浏览器 + 扩展安装导览
scripts/
  build.mjs      零依赖打包（ESM → IIFE）
  make-icons.mjs 程序化生成图标
  test.mjs       校验套件
legacy/          改造前的单文件版本，仅作对照
```

## 已知限制

- 跨域 iframe 内部不会被注入（`all_frames: false`），只能整体切外层 iframe
- 目标内含 `iframe / video / canvas` 时，碎片里该部分是同尺寸色块，不是画面快照
- DRM 视频、浏览器内部页（`chrome://`、`about:`）、扩展页、PDF 阅读器不支持
- 「加载已解压」的扩展 ID 由安装路径决定，换目录重装会丢失已有配置

## 路线图

- [x] 内置关卡与评分（教程关 + 广告一条街 + 卡片丛林）
- [x] 桌面版：内置浏览器 + 扩展安装导览（Electron，可运行，未打包）
- [ ] Steam 打包与 Steamworks 集成
- [ ] Chrome Web Store / Edge Add-ons 上架

## 支持开发

如果这个项目让你开心过，可以通过爱发电支持后续开发：

> 待填写（爱发电主页地址）

赞助不附带任何功能解锁，扩展本体始终免费完整。

## 参与贡献

见 [CONTRIBUTING.md](./CONTRIBUTING.md)。提交 PR 前请阅读 [`docs/CLA.md`](./docs/CLA.md)：
本项目采用双许可，接受贡献前需要你同意其中条款。

## 许可证

**双许可**：

| 许可 | 说明 |
| --- | --- |
| [GPL-3.0-only](./LICENSE) | 默认。可自由使用、修改、分发，衍生作品需同样以 GPL-3.0 开源 |
| [商业许可](./LICENSE-COMMERCIAL.md) | 需要在闭源产品中使用，或不愿承担 GPL 义务时另行授权 |

第一方美术与关卡资源如需独立条款，将在引入时于该目录内单独声明。
