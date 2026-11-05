# 页面清道夫 · DIY 手册

> 面向想自己改造的玩家：不写代码能改什么、写代码怎么改、改坏了怎么退回来。
> 玩法见 [manual.md](./manual.md)，长期维护见 [maintenance.md](./maintenance.md)。

## 目录

1. [先弄清你改的是哪一份](#1-先弄清你改的是哪一份)
2. [不写代码的改造](#2-不写代码的改造)
3. [动手前的准备](#3-动手前的准备)
4. [配方一：只切我想要的东西](#4-配方一-只切我想要的东西)
5. [配方二：换成我自己的音效](#5-配方二-换成我自己的音效)
6. [配方三：加一把武器](#6-配方三-加一把武器)
7. [配方四：做一关自己的](#7-配方四-做一关自己的)
8. [配方五：改图标与名字](#8-配方五-改图标与名字)
9. [配方六：打包送人](#9-配方六-打包送人)
10. [翻车现场](#10-翻车现场)
11. [许可边界](#11-许可边界)

---

## 1. 先弄清你改的是哪一份

仓库里有两份「看起来能跑」的东西：

| 位置 | 是什么 | 能不能改 |
| --- | --- | --- |
| `packages/**/src/*.js` | 源码 | **改这里** |
| `dist/**` | 构建产物 | 改了会被下一次构建覆盖 |
| `legacy/页面清道夫-v0.4.0.user.js` | 改造前的单文件存档 | 只作对照，不要在这上面开发 |

改源码后必须重新构建，再到扩展管理页点「重新加载」——**90% 的「改了没反应」都是漏了这两步中的一步**。

## 2. 不写代码的改造

打开扩展弹窗 →「高级配置」（桌面版是工具栏 ⚙），这里能覆盖绝大多数需求：

- 挡位、顿感、长按模式、连切（刀）、超大容器、自由模式、自动清理
- 五种武器的手感参数（半径、间隔、弹孔、弹仓、换弹、散布）
- 14 个音效的独立音量
- 刀光长度 / 存活时间 / 采样点数

改完点「保存」才生效。想带着配置走：用「导出 JSON 到剪贴板」，换机器后「导入」。

**试切**：配置页里有「试切」按钮，用当前未保存的参数直接切，`Esc` 退出；改坏了不会影响正式配置。

## 3. 动手前的准备

```bash
node scripts/build.mjs   # 生成 dist/
node scripts/test.mjs    # 40 项校验，改坏了这里会红
```

- 只需要 Node.js，不需要 `npm install`（桌面版除外）
- 构建会先清空 `dist/`，所以别把重要东西放在 `dist/` 里
- 构建完到 `chrome://extensions` 点扩展卡片上的「重新加载」

## 4. 配方一：只切我想要的东西

**目标：** 只在特定站点、特定区域允许切。

改 `packages/core/src/config.js` 里的默认值：

```js
// 显式目标选择器：非空时只按它找目标，忽略面积阈值
targetSelector: '.ad-banner, [data-ad]',
// 自由模式关掉后，只对选择器命中的元素生效
forceMode: false,
```

- `targetSelector` 一旦非空，就只看它，不再按面积判断
- 想「整块大容器一起切」，把 `targetSizeLevel` 设成 `'auto'`（向上找最大容器）
- 目标被判定太大而拒绝时，开 `allowOversize`（碎片按可见区域裁剪）

## 5. 配方二：换成我自己的音效

1. 把 mp3 放进 `packages/core/assets/`，用英文小写连字符命名，例如 `cannon-boom.mp3`
2. 打开 `packages/core/src/sound.js`，在 `SAMPLE_ASSETS` 里加一条：

```js
export const SAMPLE_ASSETS = {
  // 名字必须是 play('…') 里用的效果名
  cannonFire: { file: 'cannon-boom.mp3', gain: 0.8 },
  // 想让时长变短又要保持音高不变是做不到的：rate 会同时改音高
  reload: { file: 'revolver-reload.mp3', rate: 2, jitter: 0, gain: 2 },
};
```

三个可选旋钮：

| 字段 | 作用 | 什么时候用 |
| --- | --- | --- |
| `rate` | 固定播放倍速 | 录音太长，要压到和动画一样长 |
| `jitter` | 每次播放的随机倍速幅度 | 连射听起来像复读机时调到 0.1~0.2 |
| `gain` | 响度校准 | 素材偏小/偏大，配置里的「1」代表校准后的这一档 |

3. 构建，进游戏打一枪听听

**注意削波**：如果素材本来就很响，`gain × 总音量 × 倍率` 超过 1 会破音。现成的三段素材峰值都已经超过 1（见 `maintenance.md` 第 7 节），先降 `gain` 再考虑别的。

**换弹/开火的对齐**：改了 `rate` 就要同步改 `revolverReloadMs`，否则声音和画面错位。

## 6. 配方三：加一把武器

武器是「注册表 + 输入分支 + 表现」三件套。

### 6.1 注册

`packages/core/src/weapons.js`：

```js
{
  id: 'sword',
  name: '剑',
  group: 'melee',
  input: 'drag',          // drag / click / hold / drop
  implemented: true,      // 改成 true 才会出现在可用列表
  unit: '刀',
  scoring: 'area',        // 或 scoring: 'hit' + hitPoints: 26
  hitFilter: 'brightness(2.5) contrast(1.5)',
  desc: '更宽的挥砍，覆盖扇形范围。',
}
```

### 6.2 接输入

`packages/core/src/engine.js`：

| `input` | 接哪里 |
| --- | --- |
| `click` | `onPointerDown` 分支，参考左轮 / 炮 |
| `hold` | `state.firing` + 渲染循环里按冷却触发，参考机枪 |
| `drag` | 现有贯穿路径，通常只需在命中处按武器分支 |
| `drop` | 在 pointerdown 放下实体，再用渲染循环逐帧结算，参考黑洞 `placeBlackhole` / `stepBlackholes` |

### 6.3 表现与音效

- 切块 / 爆开复用 `fragments.js` 的 `spawnDOMFragments` / `spawnBlastCrack` / `spawnBlastBreakup`
- 碎片再切复用 `pieces.js` 的 `reslicePiece`
- 绘制放 `render.js`，不要在武器逻辑里直接操作画布
- 开火音在武器分支播，命中音放 `holeDestroy` 里按 `CONFIG.weapon` 播

### 6.4 验证

```bash
node scripts/build.mjs && node scripts/test.mjs
```

`test.mjs` 会检查武器字段是否完整、`input` 是否合法。桌面版可用 `ADSLASH_SELFTEST_WEAPON=sword` 跑一次真实输入。

## 7. 配方四：做一关自己的

复制 `packages/play/levels/ads-alley.html`，改这几处：

```html
<body
  data-level-id="my-level"
  data-level-time="45"        <!-- 秒，缺省 60 -->
  data-level-score="300"      <!-- 通关线 -->
  data-grade-s="430"          <!-- 不给就按通关线推算 -->
  data-grade-a="330"
  data-grade-b="240"
  data-next="card-grove.html" <!-- 结算页「下一关」，可留空 -->
>
```

标记目标与禁区：

```html
<div class="ad" data-target data-points="20">…</div>   <!-- 固定分数 -->
<div class="ad" data-target>…</div>                     <!-- 按面积给分 -->
<div class="news" data-decoy>…</div>                    <!-- 切到扣 25 分并断连击 -->
```

再加一条入口：`packages/play/levels/index.html` 里抄一个 `<a class="lv" href="my-level.html">`。

**必须记住**：关卡是可重玩页面，不能开「刷新后自动清理」，也不能持久化切过的元素——否则第二次进入时目标已经被隐藏，页面等于空白。现成的 `runner.js` 已经用空存储适配器，照抄即可。

## 8. 配方五：改图标与名字

- 图标：`scripts/make-icons.mjs` 里的 `renderIcon(size)` 是纯代码画的（圆角底 + 刀光 + 刀芯）。改配色/几何后运行 `node scripts/make-icons.mjs`，会重新生成 `packages/extension/icons/icon{16,32,48,128}.png`
- 名字与描述：`packages/extension/manifest.chrome.json` 与 `manifest.firefox.json` 的 `name` / `description`，以及 `packages/extension/src/popup/popup.html` 的标题
- 版本号：`package.json` + 两个 manifest，三处一起改

## 9. 配方六：打包送人

```bash
node scripts/build.mjs
```

产物：

| 路径 | 给谁 |
| --- | --- |
| `dist/extension/` | Chromium 系（Chrome / Edge / Brave / Opera / Vivaldi） |
| `dist/extension-firefox/` | Firefox（临时载入，或自行签名） |
| `dist/页面清道夫.user.js` | Tampermonkey 等管理器 |
| `dist/desktop/` | Electron 运行时（需自己配 `npm run desktop`） |

把 `dist/extension` 压成 zip 发给朋友，对方解压后「加载已解压的扩展程序」即可。

需要注意：

- 「加载已解压」的扩展 ID 由**安装路径**决定，换目录重装会被当成新扩展，配置全丢
- 想让别人长期用，正路是上架商店（Chrome Web Store / Edge Add-ons）或从 AMO 安装签名版
- 油猴脚本不打包音频采样，音效全部是合成音——这是单文件分发的固有限制

## 10. 翻车现场

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 改了没反应 | 没重新构建 / 没重载扩展 / 改的是 `dist` | 构建 → 重载，改源码 |
| 构建后改动消失 | 直接编辑了 `dist/` | 改 `packages/**/src` |
| 页面变成空白 | 开了自动清理并记住了切过的元素 | 弹窗「清空本域名记录」 |
| 关卡第二次进是空的 | 关卡持久化了清理记录 | 用空存储适配器 + 关自动清理 |
| 声音破音 | 采样峰值 × 增益 > 1 | 降 `gain` |
| 第一次开火没声 | 采样还没解码完 | 确认 `play()` 入口有预载 |
| 导入了 JSON 不生效 | 导入了但没点保存 | 导入后再点「保存」 |
| 测试红了 | 改了手感参数但没同步断言 | 改 `test.mjs` 或恢复参数 |

## 11. 许可边界

本项目是 **GPL-3.0-only + 商业授权**双许可：

- 自己玩、自己改：随便改，不用问
- 改完发给别人（含发布到商店、打包分发）：属于分发衍生作品，**必须同样以 GPL-3.0 开源**，并保留版权与许可声明
- 想在闭源产品里用、或不愿承担 GPL 义务：需要另购商业授权（见 [LICENSE-COMMERCIAL.md](../LICENSE-COMMERCIAL.md)）
- 引入第三方素材（音效、图标、字体）前先确认许可兼容，并在对应目录内单独声明
