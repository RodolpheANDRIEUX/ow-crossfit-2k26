/**
 * Genere le logo et les icones de l'application a partir de public/logo.png :
 * recadrage carre centre, puis reduction par moyenne de zones (net, sans
 * crenelage). Aucune dependance : decodage et encodage PNG faits ici.
 *
 * Le fichier source n'est pas modifie ; il est exclu du cache hors-ligne
 * (trop lourd), l'application n'utilise que les versions reduites.
 *
 *   node scripts/make-icons.mjs
 */
import { deflateSync, inflateSync } from 'node:zlib';
import { readFileSync, writeFileSync } from 'node:fs';

const SOURCE = new URL('../public/logo.png', import.meta.url);

/** Fond des icones d'application : un ecran d'accueil gere mal la transparence. */
const ICON_BACKGROUND = [17, 18, 20]; // #111214, la couleur du theme sombre

const OUTPUTS = [
  // [fichier, taille, fond] — le logo de l'interface garde sa transparence.
  ['logo-256.png', 256, null],
  ['icon-192.png', 192, ICON_BACKGROUND],
  ['icon-512.png', 512, ICON_BACKGROUND],
  ['favicon-64.png', 64, ICON_BACKGROUND],
];

function decodePng(buffer) {
  if (buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error("logo.png n'est pas un PNG");
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat = [];
  for (let offset = 8; offset < buffer.length; ) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }
  if (bitDepth !== 8 || interlace !== 0 || ![2, 6].includes(colorType)) {
    throw new Error(
      `PNG non pris en charge (profondeur ${bitDepth}, type ${colorType}, entrelace ${interlace}) : exporter en PNG 8 bits RGB ou RGBA`,
    );
  }

  const channels = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(width * height * 4);
  let previous = Buffer.alloc(stride);

  for (let y = 0; y < height; y++) {
    const start = y * (stride + 1);
    const filter = raw[start];
    const line = Buffer.from(raw.subarray(start + 1, start + 1 + stride));
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? line[x - channels] : 0;
      const up = previous[x];
      const upLeft = x >= channels ? previous[x - channels] : 0;
      let value = line[x];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        value += pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }
      line[x] = value & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const s = x * channels;
      const d = (y * width + x) * 4;
      pixels[d] = line[s];
      pixels[d + 1] = line[s + 1];
      pixels[d + 2] = line[s + 2];
      pixels[d + 3] = channels === 4 ? line[s + 3] : 255;
    }
    previous = line;
  }
  return { width, height, pixels };
}

/**
 * Carre centre, reduit a `size` par moyenne des pixels de chaque zone.
 *
 * La moyenne est ponderee par la transparence (alpha premultiplie) : la
 * couleur, souvent arbitraire, des pixels invisibles ne salit pas les bords du
 * halo. Avec un `background`, l'image est posee sur ce fond opaque.
 */
function squareResize({ width, height, pixels }, size, background) {
  const side = Math.min(width, height);
  const x0 = Math.floor((width - side) / 2);
  const y0 = Math.floor((height - side) / 2);
  const out = Buffer.alloc(size * size * 4);
  for (let oy = 0; oy < size; oy++) {
    const sy0 = y0 + Math.floor((oy * side) / size);
    const sy1 = Math.max(sy0 + 1, y0 + Math.floor(((oy + 1) * side) / size));
    for (let ox = 0; ox < size; ox++) {
      const sx0 = x0 + Math.floor((ox * side) / size);
      const sx1 = Math.max(sx0 + 1, x0 + Math.floor(((ox + 1) * side) / size));
      // Sommes premultipliees par l'alpha (0..1).
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          const i = (sy * width + sx) * 4;
          const alpha = pixels[i + 3] / 255;
          r += pixels[i] * alpha;
          g += pixels[i + 1] * alpha;
          b += pixels[i + 2] * alpha;
          a += alpha;
        }
      }
      const count = (sy1 - sy0) * (sx1 - sx0);
      const coverage = a / count;
      const o = (oy * size + ox) * 4;

      if (background) {
        // Composition « par-dessus » un fond opaque.
        out[o] = Math.round(r / count + background[0] * (1 - coverage));
        out[o + 1] = Math.round(g / count + background[1] * (1 - coverage));
        out[o + 2] = Math.round(b / count + background[2] * (1 - coverage));
        out[o + 3] = 255;
      } else {
        out[o] = a > 0 ? Math.round(r / a) : 0;
        out[o + 1] = a > 0 ? Math.round(g / a) : 0;
        out[o + 2] = a > 0 ? Math.round(b / a) : 0;
        out[o + 3] = Math.round(coverage * 255);
      }
    }
  }
  return out;
}

function crc32(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(rgba, size) {
  const rows = [];
  for (let y = 0; y < size; y++) {
    rows.push(Buffer.from([0]), rgba.subarray(y * size * 4, (y + 1) * size * 4));
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // profondeur
  header[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const image = decodePng(readFileSync(SOURCE));
console.log(`source : ${image.width} x ${image.height}`);
for (const [name, size, background] of OUTPUTS) {
  const png = encodePng(squareResize(image, size, background), size);
  writeFileSync(new URL(`../public/${name}`, import.meta.url), png);
  console.log(`public/${name} (${size} px, ${Math.round(png.length / 1024)} Ko)`);
}
