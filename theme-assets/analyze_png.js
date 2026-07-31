const fs = require('fs');
const zlib = require('zlib');

function decodePNG(path) {
  const buf = fs.readFileSync(path);
  let offset = 8;
  let width, height, bitDepth, colorType;
  const idatChunks = [];
  while (offset < buf.length) {
    const len = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    if (type === 'IHDR') {
      width = buf.readUInt32BE(dataStart);
      height = buf.readUInt32BE(dataStart + 4);
      bitDepth = buf.readUInt8(dataStart + 8);
      colorType = buf.readUInt8(dataStart + 9);
    } else if (type === 'IDAT') {
      idatChunks.push(buf.subarray(dataStart, dataStart + len));
    }
    offset = dataStart + len + 4;
  }
  const raw = zlib.inflateSync(Buffer.concat(idatChunks));
  const channels = colorType === 6 ? 4 : (colorType === 2 ? 3 : 1);
  const bpp = channels * (bitDepth / 8);
  const stride = width * bpp;
  const pixels = Buffer.alloc(height * stride);
  let rawOffset = 0;
  for (let y = 0; y < height; y++) {
    const filterType = raw[rawOffset]; rawOffset++;
    const rowStart = y * stride;
    const prevRowStart = (y - 1) * stride;
    for (let x = 0; x < stride; x++) {
      const raw_x = raw[rawOffset + x];
      const a = x >= bpp ? pixels[rowStart + x - bpp] : 0;
      const b = y > 0 ? pixels[prevRowStart + x] : 0;
      const c = (y > 0 && x >= bpp) ? pixels[prevRowStart + x - bpp] : 0;
      let val;
      switch (filterType) {
        case 0: val = raw_x; break;
        case 1: val = (raw_x + a) & 0xff; break;
        case 2: val = (raw_x + b) & 0xff; break;
        case 3: val = (raw_x + Math.floor((a + b) / 2)) & 0xff; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          const pr = (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
          val = (raw_x + pr) & 0xff;
          break;
        }
        default: val = raw_x;
      }
      pixels[rowStart + x] = val;
    }
    rawOffset += stride;
  }
  return { width, height, channels, pixels };
}

function alphaAt(img, x, y) {
  const idx = (y * img.width + x) * img.channels;
  return img.channels === 4 ? img.pixels[idx + 3] : 255;
}

// For each row, find leftmost/rightmost opaque pixel (alpha>10)
function rowOpaqueRange(img, y) {
  let left = -1, right = -1;
  for (let x = 0; x < img.width; x++) {
    if (alphaAt(img, x, y) > 10) { if (left === -1) left = x; right = x; }
  }
  return [left, right];
}
function colOpaqueRange(img, x) {
  let top = -1, bottom = -1;
  for (let y = 0; y < img.height; y++) {
    if (alphaAt(img, x, y) > 10) { if (top === -1) top = y; bottom = y; }
  }
  return [top, bottom];
}

const files = process.argv.slice(2);
files.forEach(f => {
  const img = decodePNG(f);
  console.log(`\n=== ${f} (${img.width}x${img.height}) ===`);
  // sample rows at several y to see opaque horizontal span (find widest "body" band)
  const sampleYs = [];
  for (let i = 1; i <= 10; i++) sampleYs.push(Math.floor(img.height * i / 11));
  sampleYs.forEach(y => {
    const [l, r] = rowOpaqueRange(img, y);
    console.log(`row y=${y}: opaque x=[${l},${r}] width=${r - l}`);
  });
  const sampleXs = [];
  for (let i = 1; i <= 10; i++) sampleXs.push(Math.floor(img.width * i / 11));
  sampleXs.forEach(x => {
    const [t, b] = colOpaqueRange(img, x);
    console.log(`col x=${x}: opaque y=[${t},${b}] height=${b - t}`);
  });
});
