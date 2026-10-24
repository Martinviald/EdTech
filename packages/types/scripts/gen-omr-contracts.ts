import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildOmrContracts, OMR_CONTRACTS_DIR } from './omr-contracts';

// Genera los JSON Schema que el servicio de visión (Python) usa para validar
// entrada/salida. UN SOLO origen de verdad (los Zod de este paquete), dos
// validadores: cualquier cambio de contrato se regenera acá, NUNCA se edita el
// JSON a mano. Correr: pnpm --filter @soe/types gen:omr-contracts
// `omr-contracts.spec.ts` falla si los archivos versionados quedan desactualizados.

mkdirSync(OMR_CONTRACTS_DIR, { recursive: true });

for (const { file, content } of buildOmrContracts()) {
  const path = resolve(OMR_CONTRACTS_DIR, file);
  writeFileSync(path, content);
  process.stdout.write(`escrito ${path}\n`);
}
