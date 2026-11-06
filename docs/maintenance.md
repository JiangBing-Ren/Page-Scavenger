# 页面清道夫 · 维护手册

> 面向长期维护者（包括接手的 AI 助手）。写的是「怎么改不出事」，不是「怎么玩」。
> 玩法见 [manual.md](./manual.md)，二次开发见 [diy.md](./diy.md)。
>
> 适用版本：0.5.0

## 目录

1. [维护边界](#1-维护边界)
2. [版本与发布](#2-版本与发布)
3. [五类日常改动](#3-五类日常改动)
4. [构建与测试纪律](#4-构建与测试纪律)
5. [CI 与远端](#5-ci-与远端)
6. [桌面版维护](#6-桌面版维护)
7. [音效资源维护](#7-音效资源维护)
8. [备份与知识库纪律](#8-备份与知识库纪律)
9. [已知技术债](#9-已知技术债)
10. [排障索引](#10-排障索引)
11. [红线](#11-红线)

---

## 1. 维护边界

```
packages/core/          ← 宿主无关，禁止 chrome.* / browser.*（测试会断言）
packages/extension/     ← 只做存储、激活、配置下发、注入
packages/userscript/    ← 同上，单文件分发
packages/play/          ← 关卡运行时 + 关卡页面
packages/configurator/  ← 展示与写配置，不实现玩法
packages/desktop/       ← Electron 外壳，不实现玩法
scripts/                ← 构建、图标、测试；不放运行时逻辑
```

判断一段代码该放哪里：**换个宿主还成立吗？** 成立就进 `core/`，否则留在宿主层。

宿主层的三件事固定不变：提供存储适配器、决定何时激活、把配置塞进来。别在宿主层里加手感判断。

## 2. 版本与发布

### 2.1 版本号

版本号是**手工同步**的，没有自动化脚本。发版前同时改三处：

| 文件 | 字段 |
| --- | --- |
| `package.json` | `version` |
| `packages/extension/manifest.chrome.json` | `version` |
| `packages/extension/manifest.firefox.json` | `version` |

漏改 manifest 的后果是浏览器商店与「加载已解压」显示的版本不一致，排查问题时极易误判。

### 2.2 发版清单

1. 三处版本号对齐
2. `node scripts/build.mjs && node scripts/test.mjs`，且确认 `dist/` 是这次重新生成的
3. 本地加载 `dist/extension`，跑一遍：斩击、五种武器各打一发、开一关、改一次配置并保存
4. 确认 `dist/*/assets/` 里有 mp3（构建会整目录拷贝，漏拷时采样会静默回落合成音）
5. 需要 Steam 演示包时再跑 `node scripts/package-steam.mjs`，并用打包后的 exe 自检一遍（`ADSLASH_SELFTEST=1`）
6. 提交并推送；CI 通过后再取 `page-cleaner-build` artifact 分发

### 2.3 分发形态

| 渠道 | 产物 | 备注 |
| --- | --- | --- |
| GitHub Releases | `dist/extension`、`dist/extension-firefox`、油猴脚本 | 打包成 zip 方便下载 |
| Chrome Web Store / Edge Add-ons | 未上架 | 上架前需要商店材料与隐私说明 |
| Firefox AMO | 未发布 | 临时载入重启失效，长期使用必须签名 |
| Steam | `dist/steam-demo/` | `node scripts/package-steam.mjs`：零依赖，复用 Electron 运行时 + `resources/app`，输出可直接当 depot 上传的目录；`steam_appid.txt` 默认占位 480，用 `STEAM_APP_ID` 覆盖 |

## 3. 五类日常改动

### 3.1 改手感参数

1. 改 `packages/core/src/config.js` 的默认值
2. 检查 `scripts/test.mjs` 是否断言该值——手感参数被测试锁定，改默认值要同步更新断言
3. 如果配置器里已经有这个字段，`DEFAULT_CONFIG` 改完即生效；没有则在 `packages/configurator/src/config.js` 的 `BASIC_FIELDS` / `ADV_FIELDS` 补一条
4. 构建 + 实机确认（参数是否更顺手只能靠人）

### 3.2 新增武器

1. `packages/core/src/weapons.js`：补定义，`implemented: true`，声明 `input` / `unit` / `scoring`（或 `hitPoints`）/ `hitFilter`
2. `packages/core/src/engine.js`：
   - `click` 类接 `onPointerDown` 分支
   - `hold` 类用 `state.firing` + 渲染循环里按冷却触发
   - `drag` 类走现有贯穿路径
   - `drop` 类在 `onPointerDown` 放下实体，再在渲染循环里逐帧结算（参考黑洞 `placeBlackhole` / `stepBlackholes`）
3. 表现放 `render.js` / `fragments.js`，不要写进宿主
4. 音效在武器分支播开火音，命中音放 `holeDestroy` 里按 `CONFIG.weapon` 分支
5. 测试：`test.mjs` 的武器框架项会校验字段完整性；自检钩子 `__levelSetWeapon` / `__levelWeaponInput` 可用

### 3.3 新增音效采样

1. 文件放 `packages/core/assets/`，英文小写连字符命名
2. `packages/core/src/sound.js` 的 `SAMPLE_ASSETS` 加条目：`file` / `rate` / `jitter` / `gain`
3. 名字必须是 `play()` 用的效果名，且 `VOICES` 里有同名合成兜底
4. 量峰值：`peak × 总音量 × 倍率 × gain ≤ 1`，超了就降 `gain`
5. 若用 `rate` 压缩了时长，同步改游戏侧动作时长（换弹、冷却）
6. 扩展的 `web_accessible_resources` 已覆盖 `assets/*`，无需改 manifest

### 3.4 新增关卡

1. 复制一份 `packages/play/levels/ads-alley.html` 作模板
2. `<body>` 上声明元数据：`data-level-id` / `data-level-time` / `data-level-score` / `data-next` / `data-grade-s|a|b`
3. 目标加 `data-target`，禁区加 `data-decoy`
4. 在 `packages/play/levels/index.html` 加一条入口
5. **不要**给关卡开 `autoApplyMarks` 或持久化清理记录——第二次进入会变成空白页

### 3.5 新增配置项

1. `packages/configurator/src/config.js`：常用项进 `BASIC_FIELDS`，高级项进 `ADV_FIELDS` 并指定 `group`
2. 新增分组要同步 `ADV_GROUPS`，否则筛选 chip 里没有入口
3. 字段类型支持 `toggle` / `select` / `range` / `text`；`range` 必须给 `min` / `max` / `step`
4. 重置与导入后走 `renderAll()` 整体重绘，别局部刷新（被筛掉的字段会残留旧值）

## 4. 构建与测试纪律

```bash
node scripts/build.mjs   # 会先清空 dist/
node scripts/test.mjs    # 40 项
```

四条不能省：

1. **构建前清空 `dist/`**（脚本已内置）。残留旧产物会替新产物兜底，导致本地全绿、CI 失败——迁路径或改引用后尤其危险。
2. **路径类改动必须做一次干净构建再跑测试**，不能只跑测试。
3. **本地 Node 24、CI Node 22**。不要用只有 24 才有的 API。
4. **改完确认产物**：`dist/extension/`、`dist/extension-firefox/`、`dist/页面清道夫.user.js`、`dist/desktop/` 都要重新生成。

## 5. CI 与远端

`.github/workflows/ci.yml`：push 到 main 或 PR 时，在 `ubuntu-latest` + Node 22 上构建、跑测试、上传 `page-cleaner-build` artifact（扩展两套 + 油猴脚本）。

排查：

- 网页端 Actions 日志需要登录；未登录时用 API 看结论：
  `GET /repos/JiangBing-Ren/Page-Scavenger/actions/runs?per_page=1` 与 `/runs/{id}/jobs`
- 先看是哪一步失败：构建失败多为新增文件没被 `build.mjs` 收录；测试失败多为断言与实现不同步

**本机 git 凭据**：credential helper 仍指向已删除的 WorkBuddy PortableGit 路径，每次 push 会打印 `git-credential-manager.exe: No such file or directory`，目前靠缓存凭据仍能推。换 token 或换机时会失败，届时应执行 `git config --global credential.helper manager`。

## 6. 桌面版维护

- 首次 `npm install` 后 Electron 二进制可能没真正下载（表现为安装很快但 `dist/` 为空），需设 `ELECTRON_MIRROR` 后手动跑 `node node_modules/electron/install.js`
- `webPreferences.backgroundThrottling` 必须为 `false`，否则失焦时 `setTimeout` 被节流到秒级，逐刀序列与碎片动画卡死
- 自检三档：
  - `ADSLASH_SELFTEST=1` → canvas、HUD、目标数
  - `+ ADSLASH_SELFTEST_LEVEL=ads-alley` → 模拟划动，输出 `after-slash` / `after-combo-cut`
  - `+ ADSLASH_SELFTEST_WEAPON=cannon` → 切武器并开一炮，输出 `after-weapon`
- `sendInputEvent` 在窗口未持续绘制时会被合并成 1~2 个 `pointermove`，交互测试要在页面内 dispatch 合成 `PointerEvent`
- 采样音效走主进程同步 IPC `asset:read`（`file://` 不能 fetch），文件名白名单校验，别放宽成正则通配

## 7. 音效资源维护

- 播放增益 = 总音量 × `sfx<Name>` × `gain`，上限 4
- 三段现有素材的逐样本峰值都超过 1（1.01 / 1.10 / 1.04），换弹在默认总音量下约 1.25，**存在削波**
- 收紧顺序：`gain` → 总音量 → 峰值限幅。不要用限幅掩盖「本来就不该那么响」
- 采样缺失时自动回落合成音，所以「没声音」通常不是采样问题，先查浏览器音频解锁与总音量

## 8. 备份与知识库纪律

**原则：任何数据在没有备份下的遗失都是灾难。** 四类数据分别有归属：

| 数据 | 位置 | 备份去处 |
| --- | --- | --- |
| 源码与文档 | 本仓库（GitHub） | 远端即备份 |
| 项目记忆 | `CODELY.md` | 私人知识库 `00_original/projects/Page-Scavenger/memory/` |
| 知识文档 | `notes/`（不进公开仓库） | 同上 |
| 技能包 | `.codely-cli/skills/` | 需要时另行打包 |

知识库（`Knowledge-Base`，private）是四层治理：`00_original`（原本，只能由 `sync_from_local.sh` 拉取）→ `01_copy`（镜像）→ `02_revised`（修订本）→ `03_canonical`（敲定本）。顺序固定：

```bash
bash tools/sync_from_local.sh
bash tools/mirror_copy.sh
bash tools/verify.sh          # 确认变更是有意的
bash tools/verify.sh --seal   # 固化基准
```

- 修订本 / 敲定本必须在 front matter 写 `source: <原本路径> <sha256>`，否则 `verify.sh` 报源漂移
- `sync_from_local.sh` 会把**本机所有源目录**的最新状态一并拉进来。汇入本项目内容时只 stage 相关路径，其他项目的 diff 留给它们自己复核
- 不要替别的项目 seal 基准、不要改它们的溯源（例：STS2 的 `mplib` 资料断档不归本项目处理）

## 9. 已知技术债

| 项 | 影响 | 缓解 |
| --- | --- | --- |
| 连切每次重新克隆源元素 | 切大容器时 DOM 短时堆积 | 关连切或降挡位；未来可加深度上限 |
| 碎片屏幕多边形 50ms 缓存 | 极快甩刀可能漏判一块 | 调小缓存或直接读布局 |
| `all_frames: false` | 跨域 iframe 内部不注入 | 只能整体切外层 |
| 媒体元素用色块代替 | 视频/DRM 内容切不出画面 | 已知限制，不做承诺 |
| 「加载已解压」扩展 ID 随路径变化 | 换目录重装丢配置 | 文档说明；上架商店后自然消失 |
| `revolverReloadMs` 与采样时长耦合 | 换素材后声画不同步 | `rate` 与时长一起改 |
| credential helper 路径失效 | 换机/换 token 无法推送 | 改 `credential.helper manager` |

## 10. 排障索引

| 症状 | 首要怀疑 | 动作 |
| --- | --- | --- |
| 改了没生效 | 扩展未重载 / 改的是 `dist` 被覆盖 | 扩展管理页重新加载；改源码而非产物 |
| 本地通过、CI 失败 | `dist/` 残留旧产物 | 删 `dist/` 重新构建 |
| 页面空白 | 持久化了清理记录（可重玩页面） | 用空存储适配器 + 关自动清理 |
| 切不动 | 挡位上限 / 未贯穿 / 目标在选择器外 | 换挡位、开超大容器、查 `targetSelector` |
| 没声音 | 未发生用户交互 / 总音量为 0 / `sfx` 倍率为 0 | 点一下页面；查配置 |
| 爆音 | 采样峰值 × 增益 > 1 | 降 `gain` |
| 桌面动画卡住 | `backgroundThrottling` 未关 | 检查 `webPreferences` |
| 首播没声 | 采样解码未完成 | 确认 `play()` 入口预载 |
| 关卡空白 | 上一次的 marks 被套用 | 关卡用空存储适配器 |

## 11. 红线

改动这些之前先想清楚，改完必须实机确认：

1. **表现层**：整屏白闪与震屏只在「目标被摧毁」那一刻触发一次；逐刀过程只用静态亮度表示进度（频闪不适）；炮的裂缝阶段必须低亮度，提亮会把透明裂缝洗白。
2. **手感参数**：`config.js` 的数值来自长期手动调优，测试锁定；不要为了「看起来更合理」而改。
3. **音效分层**：开火音与破坏音必须分开；所有音效走 `sound.js` 的 `play(name)`，不要另开 `AudioContext`。
4. **许可**：GPL-3.0-only + 商业授权双许可。新增第三方资源前先确认许可兼容，并在目录内单独声明。
