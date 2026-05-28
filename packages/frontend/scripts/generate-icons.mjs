// Generates placeholder PWA icons (192x192 and 512x512) and a favicon SVG.
// Solid background with the project initials "HB" centered. No external deps.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, '..', 'public');
mkdirSync(outDir, { recursive: true });

const BG = [0x0f, 0x17, 0x2a]; // --bg
const FG = [0xe2, 0xe8, 0xf0]; // --fg

// 5x7 pixel font for H and B, packed as rows.
const GLYPHS = {
  H: [
    0b10001,
    0b10001,
    0b10001,
    0b11111,
    0b10001,
    0b10001,
    0b10001,
  ],
  B: [
    0b11110,
    0b10001,
    0b10001,
    0b11110,
    0b10001,
    0b10001,
    0b11110,
  ],
};
const GLYPH_W = 5;
const GLYPH_H = 7;

function makeSolidRgba(size, scale) {
  // Build pixel buffer with BG fill, then stamp "HB" centered.
  const stride = size * 4;
  const buf = Buffer.alloc(size * stride);
  for (let i = 0; i < buf.length; i += 4) {
    buf[i] = BG[0];
    buf[i + 1] = BG[1];
    buf[i + 2] = BG[2];
    buf[i + 3] = 0xff;
  }
  const text = 'HB';
  const spacing = 1;
  const totalW = text.length * GLYPH_W + (text.length - 1) * spacing;
  const totalH = GLYPH_H;
  const pxScale = scale;
  const startX = Math.floor((size - totalW * pxScale) / 2);
  const startY = Math.floor((size - totalH * pxScale) / 2);
  for (let ci = 0; ci < text.length; ci++) {
    const glyph = GLYPHS[text[ci]];
    for (let gy = 0; gy < GLYPH_H; gy++) {
      const row = glyph[gy];
      for (let gx = 0; gx < GLYPH_W; gx++) {
        if (((row >> (GLYPH_W - 1 - gx)) & 1) === 1) {
          for (let py = 0; py < pxScale; py++) {
            for (let px = 0; px < pxScale; px++) {
              const x = startX + (ci * (GLYPH_W + spacing) + gx) * pxScale + px;
              const y = startY + gy * pxScale + py;
              const off = y * stride + x * 4;
              buf[off] = FG[0];
              buf[off + 1] = FG[1];
              buf[off + 2] = FG[2];
              buf[off + 3] = 0xff;
            }
          }
        }
      }
    }
  }
  return buf;
}

function crc32(buf) {
  let c;
  const table = (crc32.table ||= (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let v = n;
      for (let k = 0; k < 8; k++) v = v & 1 ? 0xedb88320 ^ (v >>> 1) : v >>> 1;
      t[n] = v >>> 0;
    }
    return t;
  })());
  c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(size, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  // Filtered scanlines: each row prefixed by 0 (None).
  const stride = size * 4;
  const filtered = Buffer.alloc(size * (stride + 1));
  for (let y = 0; y < size; y++) {
    filtered[y * (stride + 1)] = 0;
    rgba.copy(filtered, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = deflateSync(filtered);
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const sizes = [
  { size: 192, scale: 14, name: 'icon-192.png' },
  { size: 512, scale: 36, name: 'icon-512.png' },
];

for (const { size, scale, name } of sizes) {
  const rgba = makeSolidRgba(size, scale);
  const png = encodePng(size, rgba);
  writeFileSync(join(outDir, name), png);
  console.log(`wrote ${name} (${png.length} bytes)`);
}

const faviconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="12" fill="#0f172a"/>
  <text x="50%" y="56%" font-family="system-ui,sans-serif" font-size="32" font-weight="700"
    text-anchor="middle" dominant-baseline="middle" fill="#e2e8f0">HB</text>
</svg>
`;
writeFileSync(join(outDir, 'favicon.svg'), faviconSvg);
console.log('wrote favicon.svg');
