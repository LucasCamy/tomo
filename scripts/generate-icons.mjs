// Gera icones PNG nitidos (16, 32, 48, 128px) para o Manifest V3 do Chrome usando apenas zlib nativo do Node.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([lenBuf, body, crcBuf]);
}

function createBookmarkIconPng(size) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const radius = size * 0.22;

  for (let y = 0; y < size; y++) {
    const rowOffset = y * (size * 4 + 1);
    raw[rowOffset] = 0; // filter None

    for (let x = 0; x < size; x++) {
      const px = x + 0.5;
      const py = y + 0.5;

      // Rounded rect SDF
      const cx = Math.max(radius, Math.min(size - radius, px));
      const cy = Math.max(radius, Math.min(size - radius, py));
      const dist = Math.hypot(px - cx, py - cy) - radius;

      const offset = rowOffset + 1 + x * 4;
      if (dist > 0.6) {
        raw[offset] = 0;
        raw[offset + 1] = 0;
        raw[offset + 2] = 0;
        raw[offset + 3] = 0;
        continue;
      }

      const alpha = dist > -0.6 ? Math.round(((0.6 - dist) / 1.2) * 255) : 255;

      // Base surface #13171E
      let r = 0x13;
      let g = 0x17;
      let b = 0x1e;

      // Subtle border ring
      if (dist > -Math.max(1.2, size * 0.045)) {
        r = 0x2c;
        g = 0x35;
        b = 0x45;
      }

      // Book spine line on left (#F3F0EA subtle)
      const nx = px / size;
      const ny = py / size;

      if (nx >= 0.23 && nx <= 0.29 && ny >= 0.18 && ny <= 0.82) {
        r = 0xf3;
        g = 0xf0;
        b = 0xea;
      }

      // Bookmark ribbon with V-notch at bottom (#F59B4C)
      const inRibbonX = nx >= 0.41 && nx <= 0.75;
      const ribbonCenter = 0.58;
      const notchHeight = 0.14 - Math.abs(nx - ribbonCenter) * 0.82;
      const inRibbonY = ny >= 0.14 && ny <= 0.78 - Math.max(0, notchHeight);

      if (inRibbonX && inRibbonY) {
        r = 0xf5;
        g = 0x9b;
        b = 0x4c;
      }

      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      raw[offset + 3] = alpha;
    }
  }

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const outDir = resolve('public/icons');
mkdirSync(outDir, { recursive: true });

for (const size of [16, 32, 48, 128]) {
  const png = createBookmarkIconPng(size);
  writeFileSync(resolve(outDir, `icon-${size}.png`), png);
}

console.log('Icones PNG gerados em public/icons (16, 32, 48, 128px).');
