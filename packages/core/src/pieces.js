// 碎片注册表：让碎片自己也能被再次切开。
// 每块碎片记录「局部多边形 + 基础矩形 + 重建函数」，重切时把屏幕刀线逆变换回局部坐标。
import { polygonArea } from './geometry.js';

const registry = new Map();
let seq = 0;

export function registerPiece(node, meta) {
  const id = ++seq;
  node.__pieceId = id;
  registry.set(id, { id, node, meta });
  return id;
}

export function unregisterPiece(node) {
  const id = node && node.__pieceId;
  if (id) registry.delete(id);
}

export function clearPieces() {
  registry.clear();
}

export function pieceCount() {
  return registry.size;
}

// 凸多边形求交：f>0 归左，f<0 归右。刀线穿过顶点时两侧都保留，避免丢面积。
export function splitPolygon(poly, a, dx, dy) {
  const EPS = 1e-6;
  const left = [];
  const right = [];

  const f = (p) => dx * (p.y - a.y) - dy * (p.x - a.x);

  for (let i = 0; i < poly.length; i++) {
    const p1 = poly[i];
    const p2 = poly[(i + 1) % poly.length];
    const f1 = f(p1);
    const f2 = f(p2);

    if (f1 > EPS) left.push(p1);
    else if (f1 < -EPS) right.push(p1);
    else {
      left.push(p1);
      right.push(p1);
    }

    if ((f1 > EPS && f2 < -EPS) || (f1 < -EPS && f2 > EPS)) {
      const t = f1 / (f1 - f2);
      const ip = { x: p1.x + (p2.x - p1.x) * t, y: p1.y + (p2.y - p1.y) * t };
      left.push(ip);
      right.push(ip);
    }
  }

  return { left, right };
}

function currentMatrix(node) {
  try {
    const t = window.getComputedStyle(node).transform;
    return new DOMMatrix(t === 'none' ? undefined : t);
  } catch (e) {
    return new DOMMatrix();
  }
}

// 局部坐标 → 屏幕坐标。transform-origin 固定在中心。
export function localToScreen(node, meta, point) {
  const m = currentMatrix(node);
  const ox = meta.box.width / 2;
  const oy = meta.box.height / 2;
  const pt = new DOMPoint(point.x - ox, point.y - oy).matrixTransform(m);
  return { x: pt.x + meta.box.left + ox, y: pt.y + meta.box.top + oy };
}

export function screenToLocal(node, meta, point) {
  const m = currentMatrix(node);
  const inv = m.inverse();
  const ox = meta.box.width / 2;
  const oy = meta.box.height / 2;
  const pt = new DOMPoint(
    point.x - meta.box.left - ox,
    point.y - meta.box.top - oy
  ).matrixTransform(inv);
  return { x: pt.x + ox, y: pt.y + oy };
}

// 碎片的屏幕多边形，50ms 内复用，避免每个采样点都读一次 computedStyle
function screenPolygon(item, now) {
  const cached = item.meta.screenCache;
  if (cached && now - cached.at < 50) return cached.poly;

  const meta = item.meta;
  const poly = meta.polygon.map((p) => localToScreen(item.node, meta, p));
  meta.screenCache = { at: now, poly };
  return poly;
}

export function pointInPolygon(poly, x, y) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

export function piecesAt(x, y, now) {
  const hits = [];
  for (const item of registry.values()) {
    if (!item.node.isConnected) {
      registry.delete(item.id);
      continue;
    }
    if (pointInPolygon(screenPolygon(item, now), x, y)) hits.push(item);
  }
  return hits;
}

export function getPiece(id) {
  return registry.get(id);
}

// 顺序切割：每条刀线作用于当前所有块，得到 N+1 块（次元斩的几何基础）
export function splitPolygonMany(polygon, cuts, minArea) {
  const limit = Number.isFinite(minArea) ? minArea : 0;
  let pieces = [polygon];

  for (const cut of cuts) {
    const next = [];
    for (const poly of pieces) {
      const { left, right } = splitPolygon(poly, cut.a, cut.dx, cut.dy);

      if (left.length >= 3 && polygonArea(left) > 0) next.push(left);
      if (right.length >= 3 && polygonArea(right) > 0) next.push(right);
    }
    pieces = next;
    if (pieces.length === 0) break;
  }

  return pieces.filter((p) => polygonArea(p) >= limit);
}
