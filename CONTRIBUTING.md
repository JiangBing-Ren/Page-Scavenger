# 参与贡献

## 提交前自检

```bash
node scripts/build.mjs   # 生成 dist/
node scripts/test.mjs    # 几何 / 参数 / 产物 / manifest 校验
```

两项都必须通过。

## 代码约定

- **`packages/core` 必须与宿主无关**：不得出现 `chrome.` / `browser.` / Electron API，`scripts/test.mjs` 会断言这一点。宿主能力放进 `packages/extension`、`packages/userscript`，或将来的桌面壳。
- **不引入运行时第三方依赖**：构建链是零依赖的（自写 ESM→IIFE 打包器），请保持。
- **手感参数不可随意改动**：`packages/core/src/config.js` 里的数值经过长期手动调优，`scripts/test.mjs` 会锁定关键项。确有必要改动时，在 PR 描述里说明动机，并附前后对比（视频或截图）。
- 提交信息用中文或英文均可，描述清楚"改了什么、为什么"。

## 目录职责

| 目录 | 职责 |
| --- | --- |
| `packages/core` | 斩击引擎：判定、切分、特效、渲染循环 |
| `packages/extension` | MV3 外壳：内容脚本、后台、弹窗、教程关 |
| `packages/userscript` | 油猴适配层 |
| `packages/desktop` | Electron 桌面版：内置浏览器 + 扩展安装导览 |
| `scripts` | 构建、图标生成、校验 |
| `legacy` | 改造前的单文件版本，仅作对照，不再更新 |

## 贡献者许可协议（CLA）

本项目采用[双许可](./LICENSE-COMMERCIAL.md)：社区版 GPL-3.0-only，同时对外提供商业许可。
为避免出现项目方无权商业授权的代码，**接受贡献前需要你同意 [`docs/CLA.md`](./docs/CLA.md)**。

提交 Pull Request 时，请在模板中勾选 CLA 确认项。仅提交 Issue、Bug 复现、文档建议不需要。

## 报告问题

请使用 Issue 模板，并尽量提供：浏览器与版本、复现网址或截图、是否开启「自由模式」、尺寸挡位与顿感设置。
涉及具体网站时，如果页面内容敏感，可以只描述结构（例如"卡片列表、单卡约 300×180"）而不贴截图。
