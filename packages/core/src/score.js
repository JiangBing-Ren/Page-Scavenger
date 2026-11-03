// 关卡计分。纯函数，方便单测与稳定回归。
// 分数只依赖输入，不碰 DOM。

// 目标基础分：按面积分档。面积是 CSS 像素。
export function basePointsForArea(area) {
  if (!Number.isFinite(area) || area <= 0) return 10;
  if (area < 15000) return 10;
  if (area < 60000) return 20;
  if (area < 200000) return 40;
  return 80;
}

// 连击倍率：第 n 连击为 1 + 0.25 * (n - 1)，上限 3 倍
export function comboMultiplier(combo) {
  const n = Math.max(1, Math.floor(Number(combo) || 1));
  return Math.min(3, 1 + 0.25 * (n - 1));
}

// 切到禁区（正文 / 按钮等）的扣分
export function decoyPenalty(count) {
  return 25 * Math.max(0, Math.floor(Number(count) || 0));
}

// 通关后的时间奖励
export function timeBonus(secondsLeft) {
  const left = Number(secondsLeft);
  if (!Number.isFinite(left) || left <= 0) return 0;
  return Math.round(left * 2);
}

// 评级。thresholds 形如 { s, a, b }，缺失时视为不可达。
export function gradeFor(score, thresholds) {
  const t = thresholds || {};
  const value = Number(score) || 0;
  if (Number.isFinite(t.s) && value >= t.s) return 'S';
  if (Number.isFinite(t.a) && value >= t.a) return 'A';
  if (Number.isFinite(t.b) && value >= t.b) return 'B';
  return 'C';
}

// 一刀的结算：targetPoints 为被切目标的分数数组，decoys 为误伤数量
export function scoreForSlash(targetPoints, combo, decoys) {
  const points = Array.isArray(targetPoints) ? targetPoints : [];
  const base = points.reduce((sum, n) => sum + (Number(n) || 0), 0);
  const withCombo = points.length ? Math.round(base * comboMultiplier(combo)) : 0;
  const penalty = decoyPenalty(decoys);
  return { base, withCombo, penalty, total: withCombo - penalty };
}
