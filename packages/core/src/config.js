// 手感与判定参数。数值来自 v0.4.0 实测调优，改动前先看清对应效果。
export const DEFAULT_CONFIG = {
  // 刀光轨迹
  trailLength: 25,
  trailLifeMs: 160,
  sampleStep: 4,

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

  // 松手再切除（预锁定 + 留痕）
  executeOnRelease: false,
  // 顿感：命中后碎片分离前的停顿，0 为关闭
  hitStop: 40,

  // 自由切割：不限于广告选择器，任意元素都可切
  forceMode: true,
  // auto | balance | large | medium | small
  targetSizeLevel: 'auto',
  // 允许切超出视口比例上限的巨型容器（碎片按可见区域裁剪）。默认关闭，行为与旧版一致
  allowOversize: false,
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
