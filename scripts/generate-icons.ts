// ============================================================
// generate-icons.ts — Pure JS icon generator (no native deps)
// Uses raw PNG binary construction — no canvas needed.
// Run: npx ts-node scripts/generate-icons.ts
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';

const SIZES = [16, 32, 48, 128] as const;
const OUTPUT_DIR = path.join(__dirname, '..', 'public', 'icons');

// ── Color palette ─────────────────────────────────────────────
const BG_DARK   = { r: 15,  g: 15,  b: 26  }; // #0f0f1a
const BG_CARD   = { r: 26,  g: 26,  b: 46  }; // #1a1a2e
const PURPLE    = { r: 108, g: 99,  b: 255 }; // #6c63ff
const CYAN      = { r: 0,   g: 212, b: 255 }; // #00d4ff
const WHITE     = { r: 255, g: 255, b: 255 };
const LAVENDER  = { r: 167, g: 139, b: 250 }; // #a78bfa

type RGB = { r: number; g: number; b: number };

// ── RGBA pixel buffer ─────────────────────────────────────────

function createBuffer(size: number): Uint8Array {
  return new Uint8Array(size * size * 4); // RGBA
}

function setPixel(
  buf: Uint8Array,
  size: number,
  x: number,
  y: number,
  color: RGB,
  alpha: number
): void {
  if (x < 0 || x >= size || y < 0 || y >= size) return;
  const idx = (y * size + x) * 4;
  // Alpha-blend onto existing color
  const a = alpha / 255;
  buf[idx]     = Math.round(buf[idx]     * (1 - a) + color.r * a);
  buf[idx + 1] = Math.round(buf[idx + 1] * (1 - a) + color.g * a);
  buf[idx + 2] = Math.round(buf[idx + 2] * (1 - a) + color.b * a);
  buf[idx + 3] = Math.min(255, buf[idx + 3] + alpha);
}

// Anti-aliased circle fill
function drawCircle(
  buf: Uint8Array,
  size: number,
  cx: number,
  cy: number,
  r: number,
  color: RGB,
  alpha = 255
): void {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= r - 1) {
        setPixel(buf, size, x, y, color, alpha);
      } else if (dist < r) {
        const aa = Math.round((r - dist) * alpha);
        setPixel(buf, size, x, y, color, aa);
      }
    }
  }
}

// Anti-aliased circle stroke
function strokeCircle(
  buf: Uint8Array,
  size: number,
  cx: number,
  cy: number,
  r: number,
  lineWidth: number,
  color: RGB,
  alpha = 255
): void {
  const half = lineWidth / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const diff = Math.abs(dist - r);
      if (diff <= half) {
        const aa = Math.round(Math.max(0, 1 - diff / half) * alpha);
        setPixel(buf, size, x, y, color, aa);
      }
    }
  }
}

// Gradient circle fill
function drawGradientCircle(
  buf: Uint8Array,
  size: number,
  cx: number,
  cy: number,
  r: number,
  colorFrom: RGB,
  colorTo: RGB
): void {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= r) {
        const t = dist / r;
        const clampedT = Math.min(1, t);
        const color: RGB = {
          r: Math.round(colorFrom.r + (colorTo.r - colorFrom.r) * clampedT),
          g: Math.round(colorFrom.g + (colorTo.g - colorFrom.g) * clampedT),
          b: Math.round(colorFrom.b + (colorTo.b - colorFrom.b) * clampedT),
        };
        const alpha = dist <= r - 1 ? 255 : Math.round((r - dist) * 255);
        setPixel(buf, size, x, y, color, alpha);
      }
    }
  }
}

// Draw a lightning bolt polygon
function drawLightningBolt(
  buf: Uint8Array,
  size: number,
  cx: number,
  cy: number,
  scale: number
): void {
  // Define bolt points (normalized around center)
  const boltPoints: [number, number][] = [
    [3, -20],   // top right
    [-2, -2],   // upper inner right
    [7, -2],    // inner right
    [-3, 20],   // bottom left
    [2, 2],     // lower inner left
    [-7, 2],    // inner left
  ];

  const scaled = boltPoints.map(([x, y]) => [
    cx + x * scale,
    cy + y * scale,
  ] as [number, number]);

  // Rasterize the polygon using scanline fill
  for (let py = 0; py < size; py++) {
    const intersections: number[] = [];
    for (let i = 0; i < scaled.length; i++) {
      const [x1, y1] = scaled[i];
      const [x2, y2] = scaled[(i + 1) % scaled.length];
      if ((y1 <= py && py < y2) || (y2 <= py && py < y1)) {
        const t = (py - y1) / (y2 - y1);
        intersections.push(x1 + t * (x2 - x1));
      }
    }
    intersections.sort((a, b) => a - b);

    for (let k = 0; k < intersections.length - 1; k += 2) {
      const xLeft  = intersections[k];
      const xRight = intersections[k + 1];
      for (let px = Math.ceil(xLeft); px <= Math.floor(xRight); px++) {
        // Gradient from top (lavender) to bottom (cyan)
        const tY = (py - (cy - 20 * scale)) / (40 * scale);
        const clamped = Math.max(0, Math.min(1, tY));
        const color: RGB = {
          r: Math.round(LAVENDER.r + (CYAN.r - LAVENDER.r) * clamped),
          g: Math.round(LAVENDER.g + (CYAN.g - LAVENDER.g) * clamped),
          b: Math.round(LAVENDER.b + (CYAN.b - LAVENDER.b) * clamped),
        };
        setPixel(buf, size, px, py, color, 255);
      }
    }
  }
}

// ── PNG encoding ──────────────────────────────────────────────

function encodePNG(buf: Uint8Array, size: number): Buffer {
  // PNG header
  const header = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  function makeIHDR(): Buffer {
    const data = Buffer.allocUnsafe(13);
    data.writeUInt32BE(size, 0);      // width
    data.writeUInt32BE(size, 4);      // height
    data[8]  = 8;  // bit depth
    data[9]  = 2;  // color type (RGB)  — we'll use 6 (RGBA)
    data[9]  = 6;
    data[10] = 0;  // compression
    data[11] = 0;  // filter
    data[12] = 0;  // interlace
    return makeChunk('IHDR', data);
  }

  // IDAT chunk
  function makeIDAT(): Buffer {
    // Build raw image data with filter bytes
    const rawSize = size * (1 + size * 4);
    const raw = Buffer.allocUnsafe(rawSize);
    for (let y = 0; y < size; y++) {
      raw[y * (1 + size * 4)] = 0; // filter type None
      for (let x = 0; x < size; x++) {
        const srcIdx = (y * size + x) * 4;
        const dstIdx = y * (1 + size * 4) + 1 + x * 4;
        raw[dstIdx]     = buf[srcIdx];
        raw[dstIdx + 1] = buf[srcIdx + 1];
        raw[dstIdx + 2] = buf[srcIdx + 2];
        raw[dstIdx + 3] = buf[srcIdx + 3];
      }
    }
    const compressed = zlib.deflateSync(raw, { level: 9 });
    return makeChunk('IDAT', compressed);
  }

  function makeIEND(): Buffer {
    return makeChunk('IEND', Buffer.alloc(0));
  }

  function makeChunk(type: string, data: Buffer): Buffer {
    const len = Buffer.allocUnsafe(4);
    len.writeUInt32BE(data.length, 0);
    const typeBytes = Buffer.from(type, 'ascii');
    const crcInput  = Buffer.concat([typeBytes, data]);
    const crc = crc32(crcInput);
    const crcBuf = Buffer.allocUnsafe(4);
    crcBuf.writeUInt32BE(crc, 0);
    return Buffer.concat([len, typeBytes, data, crcBuf]);
  }

  return Buffer.concat([header, makeIHDR(), makeIDAT(), makeIEND()]);
}

// CRC32 implementation
function crc32(data: Buffer): number {
  const table = makeCrcTable();
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ data[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

let _crcTable: number[] | null = null;
function makeCrcTable(): number[] {
  if (_crcTable) return _crcTable;
  _crcTable = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    _crcTable[n] = c;
  }
  return _crcTable;
}

// ── Icon drawing ──────────────────────────────────────────────

function generateIcon(size: number): Buffer {
  const buf = createBuffer(size);
  const cx = size / 2;
  const cy = size / 2;
  const r  = size / 2;

  // 1. Background gradient circle
  drawGradientCircle(buf, size, cx, cy, r, BG_CARD, BG_DARK);

  // 2. Purple glow at center (radial, semi-transparent)
  if (size >= 32) {
    drawCircle(buf, size, cx, cy * 0.7, r * 0.55, PURPLE, 40);
  }

  // 3. Lightning bolt
  const boltScale = size * 0.019;
  drawLightningBolt(buf, size, cx, cy, boltScale);

  // 4. Border ring
  if (size >= 32) {
    strokeCircle(buf, size, cx, cy, r - 1.5, 1.5, PURPLE, 120);
  }

  return encodePNG(buf, size);
}

// ── Main ──────────────────────────────────────────────────────

function main(): void {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  for (const size of SIZES) {
    try {
      const png = generateIcon(size);
      const filePath = path.join(OUTPUT_DIR, `icon${size}.png`);
      fs.writeFileSync(filePath, png);
      console.log(`✓ Generated icon${size}.png (${png.length} bytes)`);
    } catch (err) {
      console.error(`✗ Failed for icon${size}:`, err);
    }
  }

  console.log(`\n✅ Icons saved to: ${OUTPUT_DIR}`);
}

main();
