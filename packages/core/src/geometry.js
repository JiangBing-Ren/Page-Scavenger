// 用直线把矩形切成两块多边形。a 为刀线经过点（相对矩形左上角），(dx, dy) 为方向。
// 落在刀线上的顶点同时属于两侧，避免刀线刚好穿过顶点时丢失面积。
export function getSplitPolygons(w, h, a, dx, dy) {
  const EPS = 1e-9;

  const corners = [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];

  const polyA = [];
  const polyB = [];

  for (let i = 0; i < 4; i++) {
    const p1 = corners[i];
    const p2 = corners[(i + 1) % 4];
    const f1 = dx * (p1.y - a.y) - dy * (p1.x - a.x);
    const f2 = dx * (p2.y - a.y) - dy * (p2.x - a.x);

    if (f1 > EPS) polyA.push(p1);
    else if (f1 < -EPS) polyB.push(p1);
    else {
      polyA.push(p1);
      polyB.push(p1);
    }

    if ((f1 > EPS && f2 < -EPS) || (f1 < -EPS && f2 > EPS)) {
      const t = f1 / (f1 - f2);
      const ip = { x: p1.x + (p2.x - p1.x) * t, y: p1.y + (p2.y - p1.y) * t };
      polyA.push(ip);
      polyB.push(ip);
    }
  }

  return { polyA, polyB };
}

export function polygonArea(poly) {
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const p1 = poly[i];
    const p2 = poly[(i + 1) % poly.length];
    sum += p1.x * p2.y - p2.x * p1.y;
  }
  return Math.abs(sum) / 2;
}

// 有符号面积：用于判断多边形绕向（SVG nonzero 填充依赖它）
export function signedArea(poly) {
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const p1 = poly[i];
    const p2 = poly[(i + 1) % poly.length];
    sum += p1.x * p2.y - p2.x * p1.y;
  }
  return sum / 2;
}

// 把多边形绕向调整到指定方向；wantNegative 为 true 表示需要负号面积
export function ensureWinding(poly, wantNegative) {
  const area = signedArea(poly);
  if (area === 0) return poly;
  const isNegative = area < 0;
  return isNegative === wantNegative ? poly : poly.slice().reverse();
}
