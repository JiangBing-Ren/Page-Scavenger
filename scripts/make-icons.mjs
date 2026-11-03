#!/usr/bin/env node
// 程序化生成扩展图标（无第三方依赖）。深色圆角底 + 青色刀身 + 白色刀芯。
import zlib from 'node:zlib';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePNG(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0; // filter: none
    rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
  }

  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + dx * t;
  const cy = ay + dy * t;
  return { dist: Math.hypot(px - cx, py - cy), t };
}

function insideRoundedRect(x, y, left, top, right, bottom, radius) {
  if (x < left || x > right || y < top || y > bottom) return false;
  const cx = Math.min(Math.max(x, left + radius), right - radius);
  const cy = Math.min(Math.max(y, top + radius), bottom - radius);
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius * radius || (x >= left + radius && x <= right - radius) || (y >= top + radius && y <= bottom - radius);
}

function renderIcon(size) {
  const SS = 4;
  const W = size * SS;

  // 高分辨率画布：预乘 alpha 累积
  const acc = new Float64Array(W * W * 4);

  const bg = [18, 21, 29];
  const blade = [0, 255, 204];
  const core = [255, 255, 255];

  const margin = W * 0.05;
  const radius = W * 0.22;
  const ax = W * 0.22;
  const ay = W * 0.78;
  const bx = W * 0.78;
  const by = W * 0.22;

  const put = (idx, rgb, alpha) => {
    if (alpha <= 0) return;
    const a = Math.min(1, alpha);
    const dstA = acc[idx + 3];
    const outA = a + dstA * (1 - a);
    if (outA <= 0) return;
    for (let c = 0; c < 3; c++) {
      acc[idx + c] = (rgb[c] * a + acc[idx + c] * dstA * (1 - a)) / outA;
    }
    acc[idx + 3] = outA;
  };

  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const idx = (y * W + x) * 4;

      if (insideRoundedRect(x + 0.5, y + 0.5, margin, margin, W - margin, W - margin, radius)) {
        put(idx, bg, 1);
      }

      const bladeEdge = distToSegment(x + 0.5, y + 0.5, ax, ay, bx, by);
      const halfWidth = (W * 0.018 + W * 0.052 * bladeEdge.t) / 2;
      if (bladeEdge.dist <= halfWidth) {
        put(idx, blade, 0.92);
      }

      const coreEdge = distToSegment(x + 0.5, y + 0.5, ax, ay, bx, by);
      const coreHalf = (W * 0.014) / 2;
      if (coreEdge.dist <= coreHalf && coreEdge.t > 0.12 && coreEdge.t < 0.94) {
        put(idx, core, 0.95);
      }
    }
  }

  // 降采样
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const idx = ((y * SS + sy) * W + (x * SS + sx)) * 4;
          const alpha = acc[idx + 3];
          r += acc[idx] * alpha;
          g += acc[idx + 1] * alpha;
          b += acc[idx + 2] * alpha;
          a += alpha;
        }
      }
      const total = SS * SS;
      const o = (y * size + x) * 4;
      if (a > 0) {
        out[o] = Math.round(r / a);
        out[o + 1] = Math.round(g / a);
        out[o + 2] = Math.round(b / a);
        out[o + 3] = Math.round((a / total) * 255);
      }
    }
  }

  return encodePNG(size, size, out);
}

export async function generateIcons() {
  const outDir = path.join(ROOT, 'packages/extension/icons');
  await fs.mkdir(outDir, { recursive: true });
  const sizes = [16, 32, 48, 128];
  for (const size of sizes) {
    await fs.writeFile(path.join(outDir, `icon${size}.png`), renderIcon(size));
  }
  return sizes;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  generateIcons().then((sizes) => console.log(`图标已生成：${sizes.join(', ')}`));
}
