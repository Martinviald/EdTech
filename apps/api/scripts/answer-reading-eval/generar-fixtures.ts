import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import type { EvalManifest, EvalSample } from '@soe/answer-reading';

export const FIXTURES_DIR = join(__dirname, 'fixtures');

const GLYPHS: Readonly<Record<string, readonly string[]>> = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  ',': ['00000', '00000', '00000', '00000', '00110', '00100', '01000'],
  '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
  '/': ['00001', '00010', '00010', '00100', '01000', '01000', '10000'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  '+': ['00000', '00100', '00100', '11111', '00100', '00100', '00000'],
  '(': ['00010', '00100', '01000', '01000', '01000', '00100', '00010'],
  ')': ['01000', '00100', '00010', '00010', '00010', '00100', '01000'],
  ';': ['00000', '01100', '01100', '00000', '01100', '00100', '01000'],
  x: ['00000', '00000', '10001', '01010', '00100', '01010', '10001'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};

const WIDTH = 480;
const HEIGHT = 160;
const PIXEL = 12;
const GLYPH_COLUMNS = 5;
const GLYPH_ROWS = 7;
const GLYPH_GAP = 1;
const INK = 20;
const PAPER = 250;
const FRAME = 170;

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodeGrayPng(pixels: Uint8Array, width: number, height: number): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.writeUInt8(8, 8);
  header.writeUInt8(0, 9);
  const rows = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y += 1) {
    rows[y * (width + 1)] = 0;
    Buffer.from(pixels.subarray(y * width, (y + 1) * width)).copy(rows, y * (width + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export function renderAnswerBox(text: string): Buffer {
  const pixels = new Uint8Array(WIDTH * HEIGHT).fill(PAPER);
  for (let x = 0; x < WIDTH; x += 1) {
    pixels[x] = FRAME;
    pixels[(HEIGHT - 1) * WIDTH + x] = FRAME;
  }
  for (let y = 0; y < HEIGHT; y += 1) {
    pixels[y * WIDTH] = FRAME;
    pixels[y * WIDTH + WIDTH - 1] = FRAME;
  }
  const advance = (GLYPH_COLUMNS + GLYPH_GAP) * PIXEL;
  const startX = Math.max(PIXEL, Math.floor((WIDTH - text.length * advance) / 2));
  const startY = Math.floor((HEIGHT - GLYPH_ROWS * PIXEL) / 2);
  [...text].forEach((char, index) => {
    const glyph = GLYPHS[char];
    if (!glyph) throw new Error(`Sin glifo para "${char}"`);
    glyph.forEach((row, gy) => {
      [...row].forEach((bit, gx) => {
        if (bit !== '1') return;
        for (let dy = 0; dy < PIXEL; dy += 1) {
          for (let dx = 0; dx < PIXEL; dx += 1) {
            const x = startX + index * advance + gx * PIXEL + dx;
            const y = startY + gy * PIXEL + dy;
            if (x < WIDTH && y < HEIGHT) pixels[y * WIDTH + x] = INK;
          }
        }
      });
    });
  });
  return encodeGrayPng(pixels, WIDTH, HEIGHT);
}

const SAMPLES: readonly EvalSample[] = [
  {
    id: 'entero-48',
    image: 'entero-48.png',
    format: { kind: 'integer', maxChars: 4, allowNegative: false },
    label: { state: 'answered', literal: '48' },
    acceptedAnswers: ['48'],
    tags: { origen: 'sintetico' },
  },
  {
    id: 'decimal-3-75',
    image: 'decimal-3-75.png',
    format: { kind: 'decimal', maxChars: 6, allowNegative: false },
    label: { state: 'answered', literal: '3,75' },
    acceptedAnswers: ['3,8'],
    tags: { origen: 'sintetico' },
  },
  {
    id: 'fraccion-5-8',
    image: 'fraccion-5-8.png',
    format: { kind: 'fraction', allowNegative: false, allowMixed: false },
    label: { state: 'answered', literal: '5/8' },
    tags: { origen: 'sintetico' },
  },
  {
    id: 'par-2-menos-3',
    image: 'par-2-menos-3.png',
    format: { kind: 'ordered_tuple', arity: 2, componentKind: 'integer' },
    label: { state: 'answered', literal: '(2;-3)' },
    tags: { origen: 'sintetico' },
  },
  {
    id: 'en-blanco',
    image: 'en-blanco.png',
    format: { kind: 'integer', maxChars: 4, allowNegative: false },
    label: { state: 'blank', literal: '' },
    tags: { origen: 'sintetico' },
  },
  {
    id: 'expresion-x-mas-1',
    image: 'expresion-x-mas-1.png',
    format: { kind: 'short_text', maxWords: 3 },
    label: { state: 'answered', literal: 'x+1' },
    tags: { origen: 'sintetico' },
  },
];

export const FIXTURES_MANIFEST: EvalManifest = {
  manifestVersion: 1,
  name: 'fixtures-sinteticos',
  datasetVersion: '1',
  description: 'Casillas dibujadas por código, sin datos personales. Para probar el arnés.',
  samples: [...SAMPLES],
};

async function main(): Promise<void> {
  await mkdir(FIXTURES_DIR, { recursive: true });
  for (const sample of SAMPLES) {
    await writeFile(join(FIXTURES_DIR, sample.image), renderAnswerBox(sample.label.literal));
  }
  await writeFile(
    join(FIXTURES_DIR, 'manifest.json'),
    `${JSON.stringify(FIXTURES_MANIFEST, null, 2)}\n`,
    'utf8',
  );
  process.stdout.write(`Fixtures escritos en ${FIXTURES_DIR}\n`);
}

if (require.main === module) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
