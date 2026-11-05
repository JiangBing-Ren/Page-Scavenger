# 页面清道夫 · Ad Slash

按住鼠标左键划过网页元素，刀光所至直接斩断：高亮框锁定 → 留痕切线 → 对半分离 → 碎片坠落。

不是一个"点一下删除"的屏蔽按钮，而是把清理网页做成一次有手感的斩击。

- 浏览器扩展：Chromium（Chrome / Edge / Brave / Opera / Vivaldi）与 Firefox
- 油猴脚本：`dist/页面清道夫.user.js`
- 手感参数经过长期手动调优，并由测试脚本锁定，防止无意改动

完整的使用与开发说明见 **[docs/manual.md](./docs/manual.md)**（安装、玩法、武器、计分、关卡、配置项、音效、桌面版、常见问题、架构与调试钩子）。

另外两本：

- **[docs/maintenance.md](./docs/maintenance.md)** —— 维护手册：发版流程、五类改动的步骤、构建与 CI 纪律、备份约定、技术债、排障索引
- **[docs/diy.md](./docs/diy.md)** —— DIY 手册：不写代码能改什么，加音效 / 加武器 / 做关卡 / 换图标的配方，翻车现场与许可边界

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

## 配置器

扩展弹窗点「高级配置」、桌面版工具栏点 ⚙，打开同一套配置页面：

- **常用**：挡位、顿感、多刀蓄力、连切、超大容器、自由切割、音效与音量、刷新后自动清理
- **高级参数**：刀光采样点数/存活时间、采样步长、搜索深度、目标尺寸上限、贯穿比例、单目标最多刀数、叠刀间距、逐刀节奏（起始间隔/递减系数/最小间隔）
- **试切预览**：用当前<b>未保存</b>的参数直接在页面上切，Esc 退出
- **武器预览**：四个按钮分别触发当前武器的「攻击效果 / 攻击特效 / 音效 / 滤镜」，便于逐项调参；「重置演示」恢复被摧毁的演示卡片
- **手动保存**：改动不即时生效，点「保存」才写入；可还原默认、导出 JSON 到剪贴板

扩展保存后会向所有已打开的标签页广播配置；桌面版写入 `settings.json` 并推给当前页面。

## 武器系统

框架已就位，**目前刀、炮、左轮、机枪、黑洞已实现**，其余为占位。定义在 `packages/core/src/weapons.js`。

| id | 名称 | 类别 | 输入 | 状态 |
| --- | --- | --- | --- | --- |
| `blade` | 刀 | 近战 | drag | 已实现 |
| `spear` | 枪 | 近战 | drag | 占位 |
| `sword` | 剑 | 近战 | drag | 占位 |
| `cannon` | 炮 | 重火力 | click | 已实现 |
| `revolver` | 左轮 | 枪械 | click | 已实现 |
| `machinegun` | 机枪 | 枪械 | hold | 已实现 |
| `laser` | 激光炮 | 重火力 | hold | 占位 |
| `grenade` | 手雷 | 投掷物 | drop | 占位 |
| `shell` | 榴弹 | 投掷物 | drop | 占位 |
| `snake` | 贪吃蛇 | 特殊 | drag | 占位 |
| `blackhole` | 黑洞 | 特殊 | drop | 已实现 |

输入类型约定：`drag` 按住拖动（贯穿判定）、`click` 单击一次、`hold` 按住持续生效、`drop` 放置或投掷后延时生效。

新增一把武器要动三处：

1. `weapons.js` 补定义，把 `implemented` 改成 `true`
2. `engine.js` 按它的 `input` 接对应输入分支（目前只有 drag 路径）
3. 实现命中与表现，可复用 `spawnDOMFragments` / `reslicePiece` / `spawnSparks`

引擎 API：`getWeapons()` / `getWeapon()` / `setWeapon(id)`。`setWeapon` 只接受已实现的武器并返回 `{ ok, reason }`；存储里若残留未实现的 id，会回退到刀，不会让斩击失灵。

**炮（cannon）** 是第一个 click 类实现：以点击点为圆心，用 `blastSamplePoints`（圆心 + 8 个环点）采样收集半径内的目标。摧毁分两拍：`spawnBlastCracks` 先让**带转折与分叉的裂缝**从弹着点由慢到快逐段生长（每段重算遮罩），长完再交给 `spawnBlastBreakup` 把目标**切成多块并逐块崩开**。半径、开火间隔、裂口大小与停留时长都在配置器里调。注意它是范围武器，**范围内的禁区也会被一起炸掉并扣分**。

高级参数按「武器 / 多刀 / 判定 / 刀光」分组，顶部带分类筛选，挑武器参数不用从头翻。

**左轮（revolver）** 是 click 类：点一次打一枪，命中光标下的单个目标。弹孔是**光滑圆孔并带升腾烟雾**（与炮的锯齿裂口区分），后坐明显、间隔长（`revolverCooldown`）。左下角有弹仓指示，打空后自动换弹（`revolverChambers` / `revolverReloadMs`），换弹期间无法射击。

**机枪（machinegun）** 是 hold 类：按下点固定为枪口，按住期间朝光标持续扫射（`machinegunCooldown`），弹孔小（`machinegunHoleRadius`）并带随机散布（`machinegunSpread`）。射击时显示枪口标记、瞄准虚线与短暂弹道。

## 使用

| 操作 | 说明 |
| --- | --- |
| 点工具栏图标 | 打开设置面板，可开关斩击 |
| `Alt+S` | 在当前页快速开关斩击 |
| 页面右键 | 「页面清道夫：开启 / 关闭斩击」 |
| 按住左键划动 | 斩击；贯穿目标（从一侧进、另一侧出）才判定命中。按住期间可对同一目标反复划，松手后一次性炸开 |
| `Esc` / 右上角 × | 退出斩击模式 |

### 自由模式计分

任意网页开启斩击后，左下角会出现计分条：按被切元素面积给分（10 / 20 / 40 / 80），900ms 内连续命中累加连击（最高 3 倍），退出斩击即重置。

自由模式**不判断对错**——切到正文也不扣分。原因是任意网页上无法可靠区分"该切"和"不该切"，任何判断都会产生明显误伤。需要策略性时用预置关卡。

计分单位跟随武器：刀按面积给分、单位「刀」；左轮每命中 26 分、机枪每命中 8 分，单位都是「发」；炮按面积给分、单位「炮」。

**连切**：切下来的碎片可以继续被切开，每切一次分成两块并向两侧分开；单块面积低于 60px² 后不再分裂。碎片会记录局部多边形与当前变换矩阵，所以旋转飞行中的碎片也能准确切开。设置里可关闭。

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
- **多刀蓄力**：按住左键期间可对同一目标反复贯穿叠刀（最多 10 刀），松手后按所有切线一次性炸开，切成 N+1 块（默认开启）
- **音效**：拆成 **14 个独立效果**（刀·挥砍/切入/碎裂、炮·开火/裂缝/爆散、左轮·开火/弹孔/换弹、机枪·开火/弹着、黑洞·生成/吸附/吞噬），每个都能单独调音量；开火音与破坏音分成两层。左轮单发/换弹与弹壳落地用真实采样（`packages/core/assets`），其余由 Web Audio 现场合成，采样缺失时自动回落合成
- **自由切割**：不限于广告选择器，任意元素都可切
- **刷新后自动清理**：记住切过的元素，再次访问同域名时自动隐藏

## 音效与音频资源

音效分两层：**能拿到采样文件就播采样，拿不到或解码失败时回落到 Web Audio 现场合成**。所以油猴版（单文件、不打包 mp3）和桌面版的本地关卡页照样有声，只是听的是合成音。

- 全部音效统一走 `sound.js` 的 `play(name)`，共 11 个命名效果，各自对应一个音量倍率 `sfx<Name>`（0 = 静音，默认 1，上限 2）
- 采样清单位于 `packages/core/src/sound.js` 的 `SAMPLE_ASSETS`，逐项声明文件、固定倍速 `rate`、音高浮动 `jitter`、响度校准 `gain`
- 播放增益 = 总音量 × 倍率 × `gain`，上限 4。**校准后的这一档就是配置里的「1」**，调音时优先动 `gain`，不要改默认倍率

| 采样 | 用途 | 原始时长 | 倍速 | 增益校准 |
| --- | --- | --- | --- | --- |
| `shell-drop.mp3` | 弹壳落地 | 0.98s | 1 | 0.6 |
| `revolver-fire.mp3` | 左轮开火 | 2.25s | 1（±8% 随机） | 0.7 |
| `revolver-reload.mp3` | 左轮换弹 | 3.22s | 2（≈1.6s，与 `revolverReloadMs` 对齐） | 2 |

逐样本实测的峰值（绝对值）：弹壳 1.01、开火 1.10、换弹 1.04 —— 三段素材本身就已经超过满刻度（MP3 解码过冲）。默认总音量 0.6 下换弹为 1.04 × 1.2 ≈ 1.25，**会削波**；听到爆音时先降该采样的 `gain`，不要动总音量。

### 新增一个采样

1. 把文件放进 `packages/core/assets/`，构建会整目录拷到各宿主
2. 在 `SAMPLE_ASSETS` 里加一条，名字必须是 `play()` 用的效果名（如 `machinegunFire`）
3. 与 `VOICES` 同名即自动优先采样，不需要改 `engine.js`
4. 扩展的 `web_accessible_resources` 已覆盖 `assets/*`，manifest 不用动

宿主只负责把文件变成 URL 或字节：

| 宿主 | 取法 |
| --- | --- |
| 扩展 content script | `sampleUrls((p) => ext.runtime.getURL(p))` |
| 桌面页面 preload | `sampleBytes((f) => ipcRenderer.sendSync('asset:read', f))`；`file://` 页面不能 `fetch` |
| 配置器试听 | 扩展走 runtime URL，桌面走 `window.desktop.assets.read` |
| 油猴 | 不打包采样，自动回落合成音 |

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
    sound.js       音效：采样优先 + Web Audio 合成兜底
    assets/        音效采样（mp3，构建时整目录拷到各宿主）
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
