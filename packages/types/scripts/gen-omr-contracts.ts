import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { layoutSpecSchema } from '../src/schemas/omr-layout.schema';
import { omrReadRequestSchema, scanResultSchema } from '../src/schemas/omr-scan.schema';

// Genera los JSON Schema que el servicio de visión (Python) usa para validar
// entrada/salida. UN SOLO origen de verdad (los Zod de este paquete), dos
// validadores: cualquier cambio de contrato se regenera acá, NUNCA se edita el
// JSON a mano. Correr: pnpm --filter @soe/types gen:omr-contracts

const outDir = resolve(__dirname, '../../../services/omr/contracts');
mkdirSync(outDir, { recursive: true });

const contracts = [
  { name: 'layout-spec', schema: layoutSpecSchema },
  { name: 'read-request', schema: omrReadRequestSchema },
  { name: 'scan-result', schema: scanResultSchema },
] as const;

for (const { name, schema } of contracts) {
  const jsonSchema = zodToJsonSchema(schema, { name, target: 'jsonSchema7' });
  const path = resolve(outDir, `${name}.schema.json`);
  writeFileSync(path, `${JSON.stringify(jsonSchema, null, 2)}\n`);
  process.stdout.write(`escrito ${path}\n`);
}
