import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { resolve } from 'node:path';
import { PDFDocument, degrees, rgb } from 'pdf-lib';
import {
  buildOmrQrPayload,
  DEFAULT_CAPTURE_PROFILES,
  layoutHash,
  scanResultSchema,
  type LayoutField,
  type LayoutSpec,
  type ScanResult,
} from '@soe/types';
import { deriveLayoutDraft, type DerivableItem } from './sheet-layout.helpers';
import { computeDrawPlan, renderSheetsPdf, type DrawPlanBubble } from './sheet-print.helpers';
import { HttpOmrClient } from './omr-http.client';

const describeRoundTrip = process.env.RUN_OMR_ROUNDTRIP === '1' ? describe : describe.skip;

const INSTRUMENT_ID = '11111111-2222-4333-8444-555555555555';
const SHEET_ID = '9f2c1a44-3b7e-4c11-9a0d-5e8f7b2c1d33';
const OMR_PORT = 8099;
const OMR_BASE = `http://127.0.0.1:${OMR_PORT}`;
const OMR_DIR = resolve(__dirname, '../../../../services/omr');
const PYTHON_BIN = resolve(OMR_DIR, '.venv/bin/python');

const RUT_RAW = '123456785';
const DIGIT_FIELD_ID = 'f_031';
const DIGIT_PRINTED_NUMBER = '31';
const DIGIT_VALUE = '407';

function makeItems(): DerivableItem[] {
  const items: DerivableItem[] = [];
  for (let i = 1; i <= 20; i++) {
    items.push({
      id: `item-mc-${i}`,
      position: i,
      printedNumber: null,
      type: 'multiple_choice',
      content: {
        alternatives: [{ key: 'A' }, { key: 'B' }, { key: 'C' }, { key: 'D' }],
      } as DerivableItem['content'],
    });
  }
  for (let i = 21; i <= 30; i++) {
    items.push({
      id: `item-tf-${i}`,
      position: i,
      printedNumber: null,
      type: 'true_false',
      content: {} as DerivableItem['content'],
    });
  }
  return items;
}

function digitGridField(): LayoutField {
  const bubbles: LayoutField['bubbles'] = [];
  for (let group = 0; group < 3; group++) {
    for (let digit = 0; digit <= 9; digit++) {
      bubbles.push({
        value: String(digit),
        center: { x: 0.72 + group * 0.05, y: 0.4 + digit * 0.022 },
        radius: 0.008,
        group,
      });
    }
  }
  return {
    fieldId: DIGIT_FIELD_ID,
    kind: 'digit_grid',
    printedNumber: DIGIT_PRINTED_NUMBER,
    pageIndex: 0,
    selectMode: 'single',
    bubbles,
    region: null,
  };
}

function makeAnswerKey(spec: LayoutSpec): Map<string, string | null> {
  const key = new Map<string, string | null>();
  spec.fields.forEach((field, index) => {
    if (field.kind !== 'bubble_group') return;
    if (index % 3 === 2) {
      key.set(field.fieldId, null);
      return;
    }
    const value = field.bubbles[index % field.bubbles.length]!.value;
    key.set(field.fieldId, value);
  });
  return key;
}

interface SheetMarks {
  answerKey: Map<string, string | null>;
  digitValues?: Map<string, string>;
  extraDigitMarks?: readonly { fieldId: string; group: number; value: string }[];
  rutRaw?: string | null;
}

function isBubbleMarked(bubble: DrawPlanBubble, marks: SheetMarks): boolean {
  if (bubble.group === null) return marks.answerKey.get(bubble.fieldId) === bubble.value;
  const digits = marks.digitValues?.get(bubble.fieldId);
  if (digits !== undefined && digits.charAt(bubble.group) === bubble.value) return true;
  return (marks.extraDigitMarks ?? []).some(
    (extra) =>
      extra.fieldId === bubble.fieldId &&
      extra.group === bubble.group &&
      extra.value === bubble.value,
  );
}

async function fillPdfAtPrinterCoordinates(
  pdfBytes: Uint8Array,
  spec: LayoutSpec,
  marks: SheetMarks,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes);
  for (let pageIndex = 0; pageIndex < spec.pageCount; pageIndex++) {
    const plan = computeDrawPlan(spec, pageIndex);
    const page = doc.getPage(pageIndex);
    const rutRaw = marks.rutRaw ?? null;
    const targets = [
      ...plan.bubbles.filter((bubble) => isBubbleMarked(bubble, marks)),
      ...plan.rutGridBubbles.filter(
        (bubble) =>
          rutRaw !== null && bubble.group !== null && rutRaw.charAt(bubble.group) === bubble.value,
      ),
    ];
    for (const bubble of targets) {
      page.drawCircle({
        x: bubble.cx,
        y: bubble.cy,
        size: bubble.radius * 0.8,
        color: rgb(0.15, 0.15, 0.18),
      });
    }
  }
  return doc.save();
}

async function scaleToFit(pdfBytes: Uint8Array, scale: number): Promise<Uint8Array> {
  const source = await PDFDocument.load(pdfBytes);
  const target = await PDFDocument.create();
  const embedded = await target.embedPdf(source, source.getPageIndices());
  for (const embeddedPage of embedded) {
    const page = target.addPage([embeddedPage.width, embeddedPage.height]);
    page.drawPage(embeddedPage, {
      x: (embeddedPage.width * (1 - scale)) / 2,
      y: (embeddedPage.height * (1 - scale)) / 2,
      xScale: scale,
      yScale: scale,
    });
  }
  return target.save();
}

async function rotate90(pdfBytes: Uint8Array): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes);
  for (const page of doc.getPages()) {
    page.setRotation(degrees(90));
  }
  return doc.save();
}

function runPythonToBase64(script: string, input?: Uint8Array): string {
  const result = spawnSync(PYTHON_BIN, ['-c', script], {
    input: input === undefined ? undefined : Buffer.from(input),
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`El helper Python falló: ${result.stderr?.toString() ?? 'sin detalle'}`);
  }
  return result.stdout.toString('ascii');
}

function rasterizeFirstPageJpegBase64(pdfBytes: Uint8Array): string {
  const script = [
    'import sys, base64',
    'import pypdfium2 as pdfium',
    'import cv2',
    'pdf = pdfium.PdfDocument(sys.stdin.buffer.read())',
    'raster = pdf[0].render(scale=200 / 72).to_numpy()',
    'converted = cv2.cvtColor(raster, cv2.COLOR_GRAY2BGR if raster.ndim == 2 else cv2.COLOR_RGB2BGR)',
    "ok, jpg = cv2.imencode('.jpg', converted, [int(cv2.IMWRITE_JPEG_QUALITY), 92])",
    "sys.stdout.write(base64.b64encode(jpg.tobytes()).decode('ascii'))",
  ].join('\n');
  return runPythonToBase64(script, pdfBytes);
}

function blankPageJpegBase64(): string {
  const script = [
    'import sys, base64',
    'import numpy as np',
    'import cv2',
    "ok, jpg = cv2.imencode('.jpg', np.full((2200, 1700), 255, np.uint8))",
    "sys.stdout.write(base64.b64encode(jpg.tobytes()).decode('ascii'))",
  ].join('\n');
  return runPythonToBase64(script);
}

async function waitForHealth(baseUrl: string, attempts: number): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok) return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`El servicio OMR no respondió /health en ${baseUrl}`);
}

interface VariantVerdict {
  firmCorrect: number;
  wrongConfident: string[];
  toReview: number;
  total: number;
}

function judge(result: ScanResult, spec: LayoutSpec, answerKey: Map<string, string | null>): VariantVerdict {
  const verdict: VariantVerdict = { firmCorrect: 0, wrongConfident: [], toReview: 0, total: 0 };
  const marksByField = new Map(result.pages.flatMap((p) => p.marks.map((m) => [m.fieldId, m] as const)));
  for (const field of spec.fields) {
    if (!answerKey.has(field.fieldId)) continue;
    verdict.total += 1;
    const expected = answerKey.get(field.fieldId) ?? null;
    const mark = marksByField.get(field.fieldId);
    if (!mark) {
      verdict.wrongConfident.push(`${field.printedNumber}: sin lectura`);
      continue;
    }
    if (mark.state === 'ambiguous' || mark.state === 'multiple') {
      verdict.toReview += 1;
      continue;
    }
    const got = mark.state === 'marked' ? mark.value : null;
    if (got === expected) {
      verdict.firmCorrect += 1;
    } else {
      verdict.wrongConfident.push(
        `${field.printedNumber}: esperado ${expected ?? 'blanco'}, leído ${got ?? 'blanco'} (${mark.state}, fill ${mark.fill}, thr ${mark.threshold})`,
      );
    }
  }
  return verdict;
}

describeRoundTrip('ida y vuelta impresión ↔ lectura (gates F3 y V1)', () => {
  jest.setTimeout(300_000);

  let omr: ChildProcessWithoutNullStreams;
  let fileServer: Server;
  let fileServerPort: number;
  const servedPdfs = new Map<string, Uint8Array>();

  let spec: LayoutSpec;
  let specHash: string;
  let answerKey: Map<string, string | null>;

  let rutSpec: LayoutSpec;
  let rutAnswerKey: Map<string, string | null>;
  let rutFilled: Uint8Array;

  beforeAll(async () => {
    const draft = deriveLayoutDraft(INSTRUMENT_ID, makeItems());
    expect(draft.excludedItems).toHaveLength(0);
    spec = draft.spec;
    specHash = layoutHash(spec);
    answerKey = makeAnswerKey(spec);

    const printed = await renderSheetsPdf(spec, specHash, [
      { printedSheetId: SHEET_ID, sequence: 1, studentName: 'Prueba, Ronda', classGroupName: '4°A' },
    ]);
    const filled = await fillPdfAtPrinterCoordinates(printed, spec, { answerKey });

    servedPdfs.set('/normal.pdf', filled);
    servedPdfs.set('/fit90.pdf', await scaleToFit(filled, 0.9));
    servedPdfs.set('/fit97.pdf', await scaleToFit(filled, 0.97));
    servedPdfs.set('/rot90.pdf', await rotate90(filled));

    const rutDraft = deriveLayoutDraft(INSTRUMENT_ID, makeItems(), 'rut_bubbles');
    expect(rutDraft.excludedItems).toHaveLength(0);
    rutSpec = { ...rutDraft.spec, fields: [...rutDraft.spec.fields, digitGridField()] };
    const rutSpecHash = layoutHash(rutSpec);
    rutAnswerKey = makeAnswerKey(rutSpec);
    rutAnswerKey.set(DIGIT_FIELD_ID, DIGIT_VALUE);

    const rutPrinted = await renderSheetsPdf(rutSpec, rutSpecHash, [
      { printedSheetId: SHEET_ID, sequence: 1, studentName: null, classGroupName: '4°A' },
    ]);
    const digitValues = new Map([[DIGIT_FIELD_ID, DIGIT_VALUE]]);
    rutFilled = await fillPdfAtPrinterCoordinates(rutPrinted, rutSpec, {
      answerKey: rutAnswerKey,
      digitValues,
      rutRaw: RUT_RAW,
    });
    servedPdfs.set('/rut-normal.pdf', rutFilled);
    servedPdfs.set('/rut-fit97.pdf', await scaleToFit(rutFilled, 0.97));
    servedPdfs.set('/rut-fit90.pdf', await scaleToFit(rutFilled, 0.9));
    servedPdfs.set(
      '/rut-doble.pdf',
      await fillPdfAtPrinterCoordinates(rutPrinted, rutSpec, {
        answerKey: rutAnswerKey,
        digitValues,
        extraDigitMarks: [{ fieldId: DIGIT_FIELD_ID, group: 1, value: '8' }],
        rutRaw: RUT_RAW,
      }),
    );

    fileServer = createServer((req, res) => {
      const body = servedPdfs.get(req.url ?? '');
      if (!body) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/pdf' });
      res.end(Buffer.from(body));
    });
    await new Promise<void>((r) => fileServer.listen(0, '127.0.0.1', r));
    const address = fileServer.address();
    if (typeof address === 'string' || address === null) throw new Error('sin puerto');
    fileServerPort = address.port;

    omr = spawn(resolve(OMR_DIR, '.venv/bin/uvicorn'), ['app.main:app', '--port', String(OMR_PORT)], {
      cwd: OMR_DIR,
    });
    await waitForHealth(OMR_BASE, 40);
  });

  afterAll(async () => {
    omr?.kill();
    await new Promise<void>((r) => fileServer?.close(() => r()));
  });

  async function readVariant(path: string, variantSpec: LayoutSpec): Promise<ScanResult> {
    const res = await fetch(`${OMR_BASE}/v1/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        layoutSpec: variantSpec,
        captureProfile: DEFAULT_CAPTURE_PROFILES.scanner,
        source: {
          kind: 'pdf',
          pdfUrl: `http://127.0.0.1:${fileServerPort}${path}`,
          imageUrls: null,
        },
      }),
    });
    expect(res.status).toBe(200);
    return scanResultSchema.parse(await res.json());
  }

  describe('MVP: QR + bubble_groups (gate F3)', () => {
    it.each([
      ['impresión normal', '/normal.pdf'],
      ['ajustar a página 97%', '/fit97.pdf'],
      ['ajustar a página 90% (D7)', '/fit90.pdf'],
      ['escaneada rotada 90°', '/rot90.pdf'],
    ])('%s: cero lecturas incorrectas confiadas', async (_name, path) => {
      const result = await readVariant(path, spec);
      expect(result.pages).toHaveLength(1);

      const page = result.pages[0]!;
      expect(page.quality.ok).toBe(true);
      expect(page.identity.raw).toBe(
        buildOmrQrPayload({ printedSheetId: SHEET_ID, layoutHash: specHash, pageIndex: 0, pageCount: spec.pageCount }),
      );

      const verdict = judge(result, spec, answerKey);
      expect(verdict.wrongConfident).toEqual([]);
      expect(verdict.firmCorrect / verdict.total).toBeGreaterThanOrEqual(0.95);
    });
  });

  describe('v1: digit_grid + identidad RUT (gate V1, CD-8/CD-10)', () => {
    it.each([
      ['impresión normal', '/rut-normal.pdf'],
      ['ajustar a página 97%', '/rut-fit97.pdf'],
      ['ajustar a página 90% (D7)', '/rut-fit90.pdf'],
    ])('%s: número y RUT exactos, cero incorrectas confiadas', async (_name, path) => {
      const result = await readVariant(path, rutSpec);
      expect(result.pages).toHaveLength(1);

      const page = result.pages[0]!;
      expect(page.quality.ok).toBe(true);
      expect(page.identity.mode).toBe('rut_bubbles');
      expect(page.identity.raw).toBe(RUT_RAW);
      expect(page.identity.confidence).toBeGreaterThan(0);

      const digitMark = page.marks.find((m) => m.fieldId === DIGIT_FIELD_ID);
      expect(digitMark?.state).toBe('marked');
      expect(digitMark?.value).toBe(DIGIT_VALUE);

      const verdict = judge(result, rutSpec, rutAnswerKey);
      expect(verdict.wrongConfident).toEqual([]);
      expect(verdict.firmCorrect / verdict.total).toBeGreaterThanOrEqual(0.95);
    });

    it('doble marca en un dígito: el campo entero llega ambiguous, jamás un número', async () => {
      const result = await readVariant('/rut-doble.pdf', rutSpec);
      const page = result.pages[0]!;
      expect(page.quality.ok).toBe(true);

      const digitMark = page.marks.find((m) => m.fieldId === DIGIT_FIELD_ID);
      expect(digitMark?.state).toBe('ambiguous');
      expect(digitMark?.value).toBeNull();

      const verdict = judge(result, rutSpec, rutAnswerKey);
      expect(verdict.wrongConfident).toEqual([]);
    });
  });

  describe('v1: POST /v1/assess vía HttpOmrClient (CD-11)', () => {
    it('imagen buena: quality.ok e identidad RUT resuelta', async () => {
      const client = new HttpOmrClient({ serviceUrl: OMR_BASE });
      const result = await client.assess({
        layoutSpec: rutSpec,
        captureProfile: DEFAULT_CAPTURE_PROFILES.phone,
        imageBase64: rasterizeFirstPageJpegBase64(rutFilled),
      });

      expect(result.imageSha256).toHaveLength(64);
      expect(result.quality.ok).toBe(true);
      expect(result.identity.mode).toBe('rut_bubbles');
      expect(result.identity.raw).toBe(RUT_RAW);
    });

    it('imagen en blanco: rechazo con motivo, sin identidad', async () => {
      const client = new HttpOmrClient({ serviceUrl: OMR_BASE });
      const result = await client.assess({
        layoutSpec: rutSpec,
        captureProfile: DEFAULT_CAPTURE_PROFILES.phone,
        imageBase64: blankPageJpegBase64(),
      });

      expect(result.quality.ok).toBe(false);
      expect(result.quality.rejectReason).not.toBeNull();
      expect(result.identity.raw).toBeNull();
    });
  });
});
