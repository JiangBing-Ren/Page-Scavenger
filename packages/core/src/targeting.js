import { BASE_SELECTORS, SKIP_TAGS } from './config.js';
import { matchesAny, safeMatches } from './selector.js';

export function isTarget(el, env) {
  if (!el || el.nodeType !== 1) return false;
  if (el === document.body || el === document.documentElement) return false;
  if (env.canvas && el === env.canvas) return false;
  if (el.hasAttribute && el.hasAttribute('data-adslash-ui')) return false;
  if (SKIP_TAGS.has(el.tagName)) return false;
  if (el.isContentEditable) return false;

  if (env.config.forceMode) return true;

  if (matchesAny(el, BASE_SELECTORS)) return true;
  if (env.marks && env.marks.length && matchesAny(el, env.marks)) return true;

  return false;
}

// 从指针命中的元素向上找目标。auto 挡位取「命中线以上最大的可切容器」，
// 其余挡位取第一个符合面积阈值的目标。
export function findSlashTarget(el, env) {
  const config = env.config;
  const level = config.targetSizeLevel;

  // 关卡玩法：目标由页面显式声明，按选择器找最近的祖先，不受面积阈值影响
  if (config.targetSelector) {
    let node = el;
    let depth = 0;
    while (
      node &&
      node !== document.body &&
      node !== document.documentElement &&
      depth < config.maxAncestorDepth
    ) {
      if (node.nodeType === 1 && safeMatches(node, config.targetSelector)) return node;
      node = node.parentElement;
      depth++;
    }
    return null;
  }

  let minArea = 2500;
  let limitW = window.innerWidth * config.maxTargetRatio;
  let limitH = window.innerHeight * config.maxTargetRatio;

  const isAuto = level === 'auto';

  if (level === 'small') {
    minArea = 50;
  } else if (level === 'medium') {
    minArea = 10000;
  } else if (level === 'large') {
    minArea = 40000;
  } else if (isAuto) {
    limitW = window.innerWidth * 0.45;
    limitH = window.innerHeight * 0.45;
    minArea = 2000;
  } else if (level === 'balance') {
    minArea = 2500;
  }

  let best = null;
  let cur = el;
  let depth = 0;

  while (
    cur &&
    cur !== document.body &&
    cur !== document.documentElement &&
    depth < config.maxAncestorDepth
  ) {
    if (isTarget(cur, env)) {
      const r = cur.getBoundingClientRect();
      const area = r.width * r.height;

      if (r.width > 2 && r.height > 2 && area >= minArea) {
        if (r.width > limitW || r.height > limitH) {
          // 没有更合适的目标时，allowOversize 会退回切这个巨型容器，
          // 碎片在 fragments 里按可见区域裁剪
          if (config.allowOversize && !best) best = cur;
          break;
        }

        const cs = window.getComputedStyle(cur);
        const invisible =
          cs.display === 'inline' && !cs.backgroundImage && cs.backgroundColor === 'rgba(0, 0, 0, 0)';

        if (!invisible) {
          if (isAuto) best = cur;
          else return cur;
        }
      }
    }

    cur = cur.parentElement;
    depth++;
  }

  return best;
}
