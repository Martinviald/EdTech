import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { resolve } from 'node:path';
import { PDFDocument, degrees, rgb } from 'pdf-lib';
import {
  buildOmrQrPayload,
  DEFAULT_CAPTURE_PROFILES,
  layoutHash,
  scanResultSchema,
  type LayoutSpec,
  type ScanResult,
} from '@soe/types';
import { deriveLayoutDraft, type DerivableItem } from './sheet-layout.helpers';
import { computeDrawPlan, renderSheetsPdf } from './sheet-print.helpers';

const describeRoundTrip = process.env.RUN_OMR_ROUNDTRIP === '1' ? describe : describe.skip;

const INSTRUMENT_ID = '11111111-2222-4333-8444-555555555555';
const SHEET_ID = '9f2c1a44-3b7e-4c11-9a0d-5e8f7b2c1d33';
const OMR_PORT = 8099;
const OMR_BASE = `http://127.0.0.1:${OMR_PORT}`;

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

function makeAnswerKey(spec: LayoutSpec): Map<string, string | null> {
  const key = new Map<string, string | null>();
  spec.fields.forEach((field, index) => {
    if (index % 3 === 2) {
      key.set(field.fieldId, null);
      return;
    }
    const value = field.bubbles[index % field.bubbles.length]!.value;
    key.set(field.fieldId, value);
  });
  return key;
}

async function fillPdfAtPrinterCoordinates(
  pdfBytes: Uint8Array,
  spec: LayoutSpec,
  answerKey: Map<string, string | null>,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes);
  for (let pageIndex = 0; pageIndex < spec.pageCount; pageIndex++) {
    const plan = computeDrawPlan(spec, pageIndex);
    const page = doc.getPage(pageIndex);
    for (const bubble of plan.bubbles) {
      if (answerKey.get(bubble.fieldId) !== bubble.value) continue;
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

describeRoundTrip('ida y vuelta impresión ↔ lectura (gate F3)', () => {
  jest.setTimeout(180_000);

  let omr: ChildProcessWithoutNullStreams;
  let fileServer: Server;
  let fileServerPort: number;
  const servedPdfs = new Map<string, Uint8Array>();

  let spec: LayoutSpec;
  let specHash: string;
  let answerKey: Map<string, string | null>;

  beforeAll(async () => {
    const draft = deriveLayoutDraft(INSTRUMENT_ID, makeItems());
    expect(draft.excludedItems).toHaveLength(0);
    spec = draft.spec;
    specHash = layoutHash(spec);
    answerKey = makeAnswerKey(spec);

    const printed = await renderSheetsPdf(spec, specHash, [
      { printedSheetId: SHEET_ID, sequence: 1, studentName: 'Prueba, Ronda', classGroupName: '4°A' },
    ]);
    const filled = await fillPdfAtPrinterCoordinates(printed, spec, answerKey);

    servedPdfs.set('/normal.pdf', filled);
    servedPdfs.set('/fit90.pdf', await scaleToFit(filled, 0.9));
    servedPdfs.set('/fit97.pdf', await scaleToFit(filled, 0.97));
    servedPdfs.set('/rot90.pdf', await rotate90(filled));

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

    const omrDir = resolve(__dirname, '../../../../services/omr');
    omr = spawn(resolve(omrDir, '.venv/bin/uvicorn'), ['app.main:app', '--port', String(OMR_PORT)], {
      cwd: omrDir,
    });
    await waitForHealth(OMR_BASE, 40);
  });

  afterAll(async () => {
    omr?.kill();
    await new Promise<void>((r) => fileServer?.close(() => r()));
  });

  async function readVariant(path: string): Promise<ScanResult> {
    const res = await fetch(`${OMR_BASE}/v1/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        layoutSpec: spec,
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

  it.each([
    ['impresión normal', '/normal.pdf'],
    ['ajustar a página 97%', '/fit97.pdf'],
    ['ajustar a página 90% (D7)', '/fit90.pdf'],
    ['escaneada rotada 90°', '/rot90.pdf'],
  ])('%s: cero lecturas incorrectas confiadas', async (_name, path) => {
    const result = await readVariant(path);
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
