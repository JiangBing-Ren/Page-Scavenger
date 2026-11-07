// 手感与判定参数。数值来自 v0.4.0 实测调优，改动前先看清对应效果。
export const DEFAULT_CONFIG = {
  // 刀光轨迹
  trailLength: 25,
  trailLifeMs: 160,
  sampleStep: 4,
  // 刀的斩击形态：'classic' 蓝白刀光 + 直接散开（默认）/ 'slash' Slash wipe 白热刃口 + 两半滑开分离
  bladeStyle: 'classic',
  // Slash wipe 序列总时长（ms）。420 与现有挥砍节奏对齐，1700 接近 pixelfx 原版
  bladeFxDurationMs: 420,

  // 切除后的隐藏方式：用 visibility 而非 display，避免页面重排
  hideProp: 'visibility',
  hideValue: 'hidden',

  // 记住切过的元素，再次访问同域名时自动隐藏
  autoApplyMarks: true,

  // 目标搜索
  maxAncestorDepth: 15,
  maxTargetRatio: 0.85,
  // 指针从目标一侧移入、从另一侧移出才算贯穿（相对于目标尺寸的比例）
  pierceRatio: 0.6,

  // 松手再切除（预锁定 + 留痕）；开启后同一目标可反复叠刀，松手一次性炸开
  executeOnRelease: true,
  // 单目标最多累积多少刀
  maxCutsPerTarget: 10,
  // 两次叠刀之间的最小位移，避免原地抖动重复记线
  minCutGap: 18,
  // 顿感：命中后碎片分离前的停顿，0 为关闭
  hitStop: 40,

  // 自由切割：不限于广告选择器，任意元素都可切
  forceMode: true,
  // auto | balance | large | medium | small
  targetSizeLevel: 'auto',
  // 允许切超出视口比例上限的巨型容器（碎片按可见区域裁剪）。默认关闭，行为与旧版一致
  allowOversize: false,
  // 显式目标选择器。非空时只按它找目标、忽略面积阈值（关卡玩法用）
  targetSelector: '',
  // 连切：切下来的碎片还能被再次切开
  comboCut: true,
  // 音效（有采样文件就播采样，缺失时回落到 Web Audio 现场合成）
  soundEnabled: true,
  soundVolume: 0.6,
  // 逐刀切割节奏：每刀间隔从 base 起按 decay 递减，不低于 min
  cutStepBase: 170,
  cutStepDecay: 0.72,
  cutStepMin: 45,
  // 当前武器（见 weapons.js）。已实现：blade / cannon / revolver / machinegun / blackhole
  weapon: 'blade',
  // 炮：爆破半径与两次开火的最小间隔
  cannonRadius: 140,
  weaponCooldown: 150,
  // 炮：洞口半径系数（相对 cannonRadius）与主体停留时长（ms）
  blastHoleScale: 0.85,
  blastHoleHold: 620,
  // 炮：破碎形态。'classic' 放射裂纹 + 扇形碎块（默认）/ 'shatter' 玻璃楔形碎裂
  cannonBreakStyle: 'classic',
  // 玻璃碎裂总时长（ms）。1400 与现有炮手感对齐，2800 接近 pixelfx 原版节奏
  shatterDurationMs: 1400,
  // 炮：裂缝形态，宽度与长度都以洞口半径为基准
  crackWidth: 0.14,
  crackLength: 1,
  crackStartWidth: 1.1,
  crackEndWidth: 0.25,
  // 左轮：单发，弹孔大、射速慢
  revolverHoleRadius: 34,
  revolverCooldown: 250,
  // 左轮弹仓：容量与换弹耗时
  revolverChambers: 6,
  // 与 2 倍速换弹采样（原始 3.216 秒 → 约 1.6 秒）对齐，弹巢旋转动画同步
  revolverReloadMs: 1600,
  // 机枪：连射，弹孔小、有散布
  machinegunHoleRadius: 18,
  machinegunCooldown: 90,
  machinegunSpread: 12,
  // 黑洞：点击放置奇点；长按模式下按住拖动，跟随光标吞吸
  // 视觉形态：'3d' 倾斜差速吸积盘（默认）/ '2d' 平面 void-orb（备选）
  blackholeStyle: '3d',
  blackholeRadius: 150,
  blackholeDurationMs: 2400,
  blackholeCooldown: 700,
  // 引力场：在视界外再延伸 R × 该值（半径 1 → 场半径 1.5）
  blackholeFieldRatio: 0.5,
  // 面积比上限：目标面积 / 黑洞圆面积，超过就吸不动
  blackholeCaptureRatio: 1.35,
  // 撕裂阈值与碎片尺寸：超过该面积比就撕碎，每块面积 = 该值 × 黑洞面积
  blackholeTearRatio: 0.7,
  // 吸入面积折算成成长的效率（0.01 ≈ 每吃一个中等目标半径涨 1px 量级）
  blackholeGrowEfficiency: 0.01,
  // 黑洞面积上限 = 视口面积 × 该值
  blackholeMaxAreaRatio: 0.67,
  // 武器视效开关
  muzzleFlashEnabled: true,
  shellCasingsEnabled: true,
  // 每类音效的独立音量倍率（0 = 静音），便于逐项对比差异
  sfxBladeSwing: 1,
  sfxBladeCut: 1,
  sfxBladeBreak: 1,
  sfxCannonFire: 1,
  sfxCannonCrack: 1,
  sfxCannonBreak: 1,
  sfxRevolverFire: 1,
  sfxRevolverHit: 1,
  sfxMachinegunFire: 1,
  sfxMachinegunHit: 1,
  sfxBlackholeOpen: 1,
  sfxBlackholeHum: 1,
  sfxBlackholeEat: 1,
  sfxReload: 1,
  sfxShellDrop: 1,
};

export const BASE_SELECTORS = [
  'ins.adsbygoogle',
  'iframe[src*="doubleclick.net"]',
  'iframe[src*="googlesyndication.com"]',
  'iframe[src*="adservice.google"]',
  'iframe[id^="google_ads_iframe"]',
  'iframe[id^="aswift"]',
  '[id^="div-gpt-ad"]',
  '[data-ad-slot]',
  '[data-ad-client]',
];

export const SKIP_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'OPTION']);

// 克隆碎片时无法渲染的元素，用同尺寸色块代替
export const MEDIA_SELECTOR = 'iframe, video, canvas, object, embed';

// 刀的斩击形态：classic 为原有蓝白刀光，slash 为移植自 pixelfx 的 Slash wipe
export const BLADE_STYLES = ['classic', 'slash'];

export const BLADE_STYLE_LABELS = {
  classic: '蓝白刀光（默认）',
  slash: '白热刃口 Slash wipe',
};

// 炮的破碎形态：classic 为原有放射裂纹，shatter 为移植自 pixelfx 的玻璃楔形碎裂
export const CANNON_BREAK_STYLES = ['classic', 'shatter'];

export const CANNON_BREAK_STYLE_LABELS = {
  classic: '放射裂纹（默认）',
  shatter: '玻璃碎裂 Shatter wipe',
};

// 黑洞视觉形态：两套渲染并存，运行时由 blackholeStyle 分发
export const BLACKHOLE_STYLES = ['3d', '2d'];

export const BLACKHOLE_STYLE_LABELS = {
  '3d': '3D 吸积盘（默认）',
  '2d': '2D 平面奇点',
};

export const SIZE_LEVELS = ['auto', 'balance', 'large', 'medium', 'small'];

export const SIZE_LABELS = {
  auto: '自动智能(抓大)',
  balance: '平衡',
  large: '大',
  medium: '中',
  small: '小',
};

export const HIT_STOPS = [0, 20, 40, 80, 120];

export const HIT_STOP_LABELS = {
  0: '无',
  20: '极短',
  40: '短',
  80: '中',
  120: '长',
};
