import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildOmrContracts, OMR_CONTRACTS_DIR } from './omr-contracts';

describe('contratos del servicio OMR', () => {
  it.each(buildOmrContracts().map(({ file, content }) => [file, content]))(
    '%s está al día con los Zod (si falla: pnpm --filter @soe/types gen:omr-contracts)',
    (file, content) => {
      const versioned: unknown = JSON.parse(readFileSync(resolve(OMR_CONTRACTS_DIR, file), 'utf8'));
      expect(versioned).toEqual(JSON.parse(content));
    },
  );
});
