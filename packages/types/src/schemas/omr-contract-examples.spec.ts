import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { layoutSpecSchema } from './omr-layout.schema';
import { omrReadRequestSchema, scanResultSchema } from './omr-scan.schema';

// Los mismos ejemplos que valida pytest en services/omr (test_contract.py):
// un origen de verdad, dos validadores. Si este test falla después de tocar un
// schema, hay que regenerar los JSON Schema (pnpm gen:omr-contracts) y revisar
// que el servicio Python siga honrando el contrato.

const examplesDir = resolve(__dirname, '../../../../services/omr/contracts/examples');

function loadExample(name: string): unknown {
  return JSON.parse(readFileSync(resolve(examplesDir, `${name}.example.json`), 'utf-8'));
}

describe('ejemplos compartidos del contrato OMR', () => {
  it('read-request.example.json parsea con omrReadRequestSchema', () => {
    const parsed = omrReadRequestSchema.safeParse(loadExample('read-request'));
    expect(parsed.success).toBe(true);
  });

  it('el layoutSpec del ejemplo parsea con layoutSpecSchema', () => {
    const example = loadExample('read-request') as { layoutSpec: unknown };
    expect(layoutSpecSchema.safeParse(example.layoutSpec).success).toBe(true);
  });

  it('scan-result.example.json parsea con scanResultSchema', () => {
    const parsed = scanResultSchema.safeParse(loadExample('scan-result'));
    expect(parsed.success).toBe(true);
  });

  it('layout-digit-grid-rut.example.json parsea con layoutSpecSchema', () => {
    const parsed = layoutSpecSchema.safeParse(loadExample('layout-digit-grid-rut'));
    expect(parsed.success).toBe(true);
  });

  it('layout-crop-region.example.json parsea con layoutSpecSchema', () => {
    const parsed = layoutSpecSchema.safeParse(loadExample('layout-crop-region'));
    expect(parsed.success).toBe(true);
  });

  it('CD-15: una página con identity.qrRaw parsea y una del MVP sin qrRaw también', () => {
    const example = loadExample('scan-result') as { pages: Array<{ identity: object }> };
    const withQrRaw = {
      pages: example.pages.map((page) => ({
        ...page,
        identity: { ...page.identity, qrRaw: 'academos:v1:hoja:hash:0:1' },
      })),
    };
    expect(scanResultSchema.safeParse(withQrRaw).success).toBe(true);
    expect(scanResultSchema.safeParse(example).success).toBe(true);
  });
});
