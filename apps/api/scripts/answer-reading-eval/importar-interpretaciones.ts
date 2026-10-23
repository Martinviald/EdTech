import { resolve } from 'node:path';
import { renderInterpretationPrompt } from '@soe/answer-reading';
import { loadDataset } from './dataset';
import {
  ReadingCache,
  cachedReadingEntry,
  readingCacheKey,
  type ReadingCacheKeyInput,
} from './reading-cache';
import { loadRouteSet, resolveSampleRoute } from './route-set';

const POC_OUTPUT_SCHEMA_ID = 'poc-interpretacion-output@1';
const IMPORT_SOURCE = 'poc-interpretacion';

function argument(argv: readonly string[], name: string): string {
  const index = argv.indexOf(`--${name}`);
  const value = index >= 0 ? argv[index + 1] : undefined;
  if (!value) throw new Error(`Falta --${name}`);
  return value;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dataset = await loadDataset(resolve(argument(argv, 'dataset')));
  const routeSet = await loadRouteSet(resolve(argument(argv, 'routes')));
  const cache = new ReadingCache(resolve(argument(argv, 'cache-dir')), 'use');
  const counts = { imported: 0, present: 0, missing: 0 };
  for (const prepared of dataset.samples) {
    const route = resolveSampleRoute(routeSet, prepared.context);
    if (route?.policy.readMode !== 'interpreted' || prepared.image === null) continue;
    for (const reader of route.readers) {
      const rendered = renderInterpretationPrompt(reader, prepared.sample.format, {
        gradeName: prepared.sample.gradeName ?? null,
        space: prepared.sample.answerSpace ?? null,
      });
      const keyInput: ReadingCacheKeyInput = {
        reader,
        prompt: rendered.prompt,
        outputJsonSchema: rendered.outputSchema,
        imageSha256: prepared.image.sha256,
        repetition: 0,
      };
      const key = readingCacheKey(keyInput);
      if (await cache.has(key)) {
        counts.present += 1;
        continue;
      }
      const pocKey = readingCacheKey({
        ...keyInput,
        prompt: { ...rendered.prompt, outputSchemaId: POC_OUTPUT_SCHEMA_ID },
      });
      const poc = await cache.get(pocKey);
      if (!poc) {
        counts.missing += 1;
        continue;
      }
      await cache.put(
        cachedReadingEntry(key, keyInput, rendered.prompt, poc.result, IMPORT_SOURCE),
        {
          ledger: false,
        },
      );
      counts.imported += 1;
    }
  }
  process.stdout.write(
    `Importadas ${counts.imported}, ya presentes ${counts.present}, sin lectura de la PoC ${counts.missing}\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
