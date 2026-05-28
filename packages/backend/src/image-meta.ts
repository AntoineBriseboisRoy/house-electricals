// Minimal image header sniffer. Magic-byte detection + naturalWidth/Height
// extraction for PNG, JPEG, WebP. No deps.

export type ImageMeta = {
  mime: 'image/png' | 'image/jpeg' | 'image/webp';
  ext: 'png' | 'jpg' | 'webp';
  width: number;
  height: number;
};

const isPng = (b: Uint8Array): boolean =>
  b.length >= 8 &&
  b[0] === 0x89 &&
  b[1] === 0x50 &&
  b[2] === 0x4e &&
  b[3] === 0x47 &&
  b[4] === 0x0d &&
  b[5] === 0x0a &&
  b[6] === 0x1a &&
  b[7] === 0x0a;

const isJpeg = (b: Uint8Array): boolean =>
  b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

const isWebp = (b: Uint8Array): boolean =>
  b.length >= 12 &&
  b[0] === 0x52 &&
  b[1] === 0x49 &&
  b[2] === 0x46 &&
  b[3] === 0x46 &&
  b[8] === 0x57 &&
  b[9] === 0x45 &&
  b[10] === 0x42 &&
  b[11] === 0x50;

const u32be = (b: Uint8Array, o: number): number =>
  (b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!;
const u16be = (b: Uint8Array, o: number): number => (b[o]! << 8) | b[o + 1]!;
const u32le = (b: Uint8Array, o: number): number =>
  b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24);
const u24le = (b: Uint8Array, o: number): number =>
  b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16);

const pngDims = (b: Uint8Array): { width: number; height: number } => {
  // IHDR follows the signature; width @ byte 16, height @ byte 20 (both BE u32).
  return { width: u32be(b, 16), height: u32be(b, 20) };
};

const jpegDims = (b: Uint8Array): { width: number; height: number } | null => {
  // Skip SOI (FFD8). Walk markers looking for SOFn (C0..C3, C5..C7, C9..CB, CD..CF).
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1]!;
    i += 2;
    if (marker === 0xd8 || marker === 0xd9) continue; // SOI/EOI
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      // Segment: skip 2 (length) + 1 (precision), then height (2), width (2).
      return { width: u16be(b, i + 5), height: u16be(b, i + 3) };
    }
    const segLen = u16be(b, i);
    i += segLen;
  }
  return null;
};

const webpDims = (b: Uint8Array): { width: number; height: number } | null => {
  // RIFF<size>WEBP<chunkId(4)><chunkSize(4)><...>
  const chunkId = String.fromCharCode(b[12]!, b[13]!, b[14]!, b[15]!);
  if (chunkId === 'VP8 ') {
    // Lossy. Frame header at offset 23 onwards; width(2 LE, low 14 bits), height(2 LE, low 14 bits).
    if (b.length < 30) return null;
    const wLE = (b[27]! << 8) | b[26]!;
    const hLE = (b[29]! << 8) | b[28]!;
    return { width: wLE & 0x3fff, height: hLE & 0x3fff };
  }
  if (chunkId === 'VP8L') {
    // Lossless. Signature byte (0x2f) then 4 bytes of packed dims.
    if (b.length < 25) return null;
    const sig = b[20]!;
    if (sig !== 0x2f) return null;
    const v = u32le(b, 21);
    return { width: (v & 0x3fff) + 1, height: ((v >> 14) & 0x3fff) + 1 };
  }
  if (chunkId === 'VP8X') {
    // Extended. Bytes 24..29: canvas width-1 (3 LE), canvas height-1 (3 LE).
    if (b.length < 30) return null;
    return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
  }
  return null;
};

const MAX_DIMENSION = 10_000;

export const sniffImage = (bytes: Uint8Array): ImageMeta | null => {
  if (isPng(bytes)) {
    const d = pngDims(bytes);
    if (d.width > 0 && d.height > 0 && d.width <= MAX_DIMENSION && d.height <= MAX_DIMENSION) {
      return { mime: 'image/png', ext: 'png', width: d.width, height: d.height };
    }
    return null;
  }
  if (isJpeg(bytes)) {
    const d = jpegDims(bytes);
    if (d === null) return null;
    if (d.width > 0 && d.height > 0 && d.width <= MAX_DIMENSION && d.height <= MAX_DIMENSION) {
      return { mime: 'image/jpeg', ext: 'jpg', width: d.width, height: d.height };
    }
    return null;
  }
  if (isWebp(bytes)) {
    const d = webpDims(bytes);
    if (d === null) return null;
    if (d.width > 0 && d.height > 0 && d.width <= MAX_DIMENSION && d.height <= MAX_DIMENSION) {
      return { mime: 'image/webp', ext: 'webp', width: d.width, height: d.height };
    }
    return null;
  }
  return null;
};
