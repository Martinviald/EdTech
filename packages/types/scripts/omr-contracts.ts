import { resolve } from 'node:path';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { CROP_PROFILES } from '../src/schemas/answer-reading/crop.schema';
import { layoutSpecSchema } from '../src/schemas/omr-layout.schema';
import {
  omrAssessRequestSchema,
  omrAssessResultSchema,
  omrReadRequestSchema,
  scanResultSchema,
} from '../src/schemas/omr-scan.schema';

export const OMR_CONTRACTS_DIR = resolve(__dirname, '../../../services/omr/contracts');

const SCHEMAS = [
  { name: 'layout-spec', schema: layoutSpecSchema },
  { name: 'read-request', schema: omrReadRequestSchema },
  { name: 'scan-result', schema: scanResultSchema },
  { name: 'assess-request', schema: omrAssessRequestSchema },
  { name: 'assess-result', schema: omrAssessResultSchema },
] as const;

function toFileContent(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

// Archivo → contenido de cada contrato del servicio de visión (Python), generado
// desde los Zod de este paquete. Los perfiles de recorte no son un schema sino
// datos: el servicio los replica y un test de pytest los compara con este JSON.
export function buildOmrContracts(): ReadonlyArray<{ file: string; content: string }> {
  return [
    ...SCHEMAS.map(({ name, schema }) => ({
      file: `${name}.schema.json`,
      content: toFileContent(zodToJsonSchema(schema, { name, target: 'jsonSchema7' })),
    })),
    { file: 'crop-profiles.json', content: toFileContent(CROP_PROFILES) },
  ];
}
