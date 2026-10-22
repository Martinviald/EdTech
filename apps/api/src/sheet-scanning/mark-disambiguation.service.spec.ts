import { createHash } from 'node:crypto';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { Database } from '@soe/db';
import { DecisionError, type ChoiceAnswer } from '@soe/decisions';
import type { DecisionMode, LayoutField, LayoutSpec, MarkAiResolution } from '@soe/types';
import * as observability from '../common/observability/report-error';
import type { DecisionFeatureSettings, DecisionsService } from '../decisions/decisions.service';
import type { FilesService } from '../files/files.service';
import {
  MARK_DISAMBIGUATION_AUDIT_RATE,
  MARK_DISAMBIGUATION_BATCH_DEADLINE_MS,
  MarkDisambiguationService,
  type MarkDisambiguationCandidate,
} from './mark-disambiguation.service';

const ORG_ID = '22222222-2222-4222-8222-222222222222';
const BATCH_ID = '44444444-4444-4444-8444-444444444444';
const SCAN_ID = '55555555-5555-4555-8555-555555555555';

const JEV_THRESHOLDS = { agree: 0.6, solo: 0.85, unsure: 0.5 };
const OPENAI_THRESHOLDS = { agree: 0.5, solo: 0.8, unsure: 0.5 };

const dialect = new PgDialect();
const sqlOf = (condition: SQL | undefined): string =>
  condition === undefined ? '' : dialect.sqlToQuery(condition).sql;

function markIdAt(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

function auditBucket(markId: string): number {
  return parseInt(createHash('sha256').update(markId).digest('hex').slice(0, 8), 16) / 2 ** 32;
}

function findMarkId(predicate: (bucket: number) => boolean): string {
  for (let i = 0; i < 10_000; i++) {
    const id = markIdAt(i);
    if (predicate(auditBucket(id))) return id;
  }
  throw new Error('no se encontró un markId');
}

const NOT_AUDITED = findMarkId((bucket) => bucket >= MARK_DISAMBIGUATION_AUDIT_RATE);
const AUDITED = findMarkId((bucket) => bucket < MARK_DISAMBIGUATION_AUDIT_RATE);

function bubbleField(fieldId: string, overrides: Partial<LayoutField> = {}): LayoutField {
  return {
    fieldId,
    kind: 'bubble_group',
    printedNumber: fieldId,
    pageIndex: 0,
    selectMode: 'single',
    region: null,
    bubbles: ['A', 'B', 'C', 'D'].map((value, index) => ({
      value,
      center: { x: 0.2 + index * 0.05, y: 0.5 },
      radius: 0.01,
    })),
    ...overrides,
  };
}

function specWith(fields: LayoutField[]): LayoutSpec {
  return {
    specVersion: 1,
    instrumentId: '11111111-1111-4111-8111-111111111111',
    pageCount: 1,
    paper: 'letter',
    fiducials: { kind: 'corner_squares', sizeRatio: 0.03, marginRatio: 0.02 },
    identity: {
      mode: 'qr',
      region: { topLeft: { x: 0.78, y: 0.02 }, bottomRight: { x: 0.98, y: 0.18 } },
    },
    fields,
  } as LayoutSpec;
}

const SPEC = specWith([bubbleField('q1'), bubbleField('q2'), bubbleField('q3')]);

function candidate(
  overrides: Partial<MarkDisambiguationCandidate> = {},
): MarkDisambiguationCandidate {
  return {
    markId: NOT_AUDITED,
    scanId: SCAN_ID,
    fieldId: 'q1',
    state: 'ambiguous',
    cropJpegBase64: 'Y3JvcA==',
    scanState: 'read',
    autoAnnulled: false,
    doubtReason: 'margin',
    suggestedValue: 'B',
    nullConfidence: null,
    fill: 0.7,
    margin: 0.3,
    ...overrides,
  };
}

function answer(choice: string, confidence: number): ChoiceAnswer<string> {
  return { type: 'choice', choice, confidence, probabilities: { [choice]: confidence } };
}

type RecordedUpdate = { set: Record<string, unknown>; where: string };

function makeDb(selectRows: unknown[][] = [], updateReturning: unknown[][] = []) {
  let selectIdx = 0;
  let updateIdx = 0;
  const updates: RecordedUpdate[] = [];
  const chain = (rows: unknown[]) => {
    const c: Record<string, unknown> = {};
    for (const method of ['from', 'where', 'innerJoin', 'leftJoin', 'orderBy', 'limit']) {
      c[method] = () => c;
    }
    c.then = (resolve: (rows: unknown[]) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject);
    return c;
  };
  const db = {
    select: () => chain(selectRows[selectIdx++] ?? []),
    update: () => ({
      set: (set: Record<string, unknown>) => ({
        where: (where: SQL) => {
          updates.push({ set, where: sqlOf(where) });
          const rows = updateReturning[updateIdx++] ?? [{ id: 'actualizada' }];
          return {
            returning: () => Promise.resolve(rows),
            then: (resolve: (r: unknown[]) => unknown, reject?: (e: unknown) => unknown) =>
              Promise.resolve(rows).then(resolve, reject),
          };
        },
      }),
    }),
    execute: async () => [],
    transaction: async (fn: (tx: unknown) => unknown) => fn(db),
  } as unknown as Database;
  return { db, updates };
}

interface SettingsOverrides {
  jev?: Partial<DecisionFeatureSettings>;
  openai?: Partial<DecisionFeatureSettings>;
}

function settings(mode: DecisionMode, overrides: SettingsOverrides = {}) {
  const jev: DecisionFeatureSettings = {
    mode,
    engine: 'jev',
    model: 'jev-1.14.0',
    thresholds: { respuesta: JEV_THRESHOLDS },
    available: true,
    ...overrides.jev,
  };
  const openai: DecisionFeatureSettings = {
    mode,
    engine: 'openai',
    model: 'gpt-6-luna',
    thresholds: { respuesta: OPENAI_THRESHOLDS },
    available: true,
    ...overrides.openai,
  };
  return { jev, openai };
}

type EngineReply = ChoiceAnswer<string> | DecisionError | null;

interface CallRequest {
  state: unknown;
  images: unknown[];
  timeoutMs: number;
  signal: AbortSignal;
}

interface CallOptions {
  correlationId: string;
  baseline: Record<string, unknown>;
}

type EngineCall = (
  orgId: string,
  feature: string,
  request: CallRequest,
  options: CallOptions,
) => Promise<unknown>;

function makeDecisions(
  mode: DecisionMode,
  replies: { jev: EngineReply; openai: EngineReply },
  overrides: SettingsOverrides = {},
) {
  const config = settings(mode, overrides);
  const settingsOf = jest.fn(async (_orgId: string, feature: string) =>
    feature === 'mark_disambiguation_jev' ? config.jev : config.openai,
  );
  const replyFor = (feature: string): EngineReply =>
    feature === 'mark_disambiguation_jev' ? replies.jev : replies.openai;
  const modelFor = (feature: string) =>
    feature === 'mark_disambiguation_jev' ? 'jev-1.14.0' : 'gpt-6-luna';
  const evaluate = jest.fn<ReturnType<EngineCall>, Parameters<EngineCall>>(
    async (_orgId, feature) => {
      const reply = replyFor(feature);
      if (reply instanceof DecisionError) throw reply;
      if (reply === null) throw new DecisionError('upstream', 'sin respuesta');
      return { answers: { respuesta: reply }, model: modelFor(feature) };
    },
  );
  const shadow = jest.fn<ReturnType<EngineCall>, Parameters<EngineCall>>(
    async (_orgId, feature) => {
      const reply = replyFor(feature);
      if (reply === null || reply instanceof DecisionError) return null;
      return { answers: { respuesta: reply }, model: modelFor(feature) };
    },
  );
  const decisions = { settingsOf, evaluate, shadow } as unknown as DecisionsService;
  return { decisions, settingsOf, evaluate, shadow };
}

function makeService(
  mode: DecisionMode,
  replies: { jev: EngineReply; openai: EngineReply },
  options: {
    selectRows?: unknown[][];
    updateReturning?: unknown[][];
    overrides?: SettingsOverrides;
  } = {},
) {
  const { db, updates } = makeDb(options.selectRows, options.updateReturning);
  const mocks = makeDecisions(mode, replies, options.overrides);
  const buildDownloadUrl = jest.fn().mockReturnValue('https://s3.example/recorte.jpg?firma=1');
  const filesService = { buildDownloadUrl } as unknown as FilesService;
  const service = new MarkDisambiguationService(db, mocks.decisions, filesService);
  return { service, updates, buildDownloadUrl, ...mocks };
}

function resolutionOf(update: RecordedUpdate | undefined): MarkAiResolution {
  const resolution = update?.set.aiResolution as MarkAiResolution | undefined;
  if (!resolution) throw new Error('la actualización no trae ai_resolution');
  return resolution;
}

describe('MarkDisambiguationService.resolveBatch', () => {
  let reportSpy: jest.SpyInstance;
  beforeEach(() => {
    reportSpy = jest.spyOn(observability, 'reportServerError').mockImplementation(() => undefined);
  });
  afterEach(() => {
    reportSpy.mockRestore();
    jest.useRealTimers();
  });

  describe('modo efectivo', () => {
    it('con las dos features en off no llama a nadie ni reporta', async () => {
      const { service, evaluate, shadow, updates } = makeService('off', {
        jev: answer('B', 0.9),
        openai: answer('B', 0.9),
      });

      await service.resolveBatch(ORG_ID, BATCH_ID, SPEC, [candidate()]);

      expect(evaluate).not.toHaveBeenCalled();
      expect(shadow).not.toHaveBeenCalled();
      expect(updates).toHaveLength(0);
      expect(reportSpy).not.toHaveBeenCalled();
    });

    it('con modos distintos no corre y reporta mode_mismatch una sola vez por lote', async () => {
      const { service, evaluate, shadow } = makeService(
        'live',
        { jev: answer('B', 0.9), openai: answer('B', 0.9) },
        { overrides: { openai: { mode: 'shadow' } } },
      );

      await service.resolveBatch(ORG_ID, BATCH_ID, SPEC, [
        candidate(),
        candidate({ markId: markIdAt(1), fieldId: 'q2' }),
      ]);

      expect(evaluate).not.toHaveBeenCalled();
      expect(shadow).not.toHaveBeenCalled();
      expect(reportSpy).toHaveBeenCalledTimes(1);
      expect(reportSpy.mock.calls[0]?.[1]).toMatchObject({
        scope: 'mark_disambiguation.mode_mismatch',
      });
    });

    it('una fila con otro motor en el slot se trata como mal configurada', async () => {
      const { service, evaluate } = makeService(
        'live',
        { jev: answer('B', 0.9), openai: answer('B', 0.9) },
        { overrides: { jev: { engine: 'openai' } } },
      );

      await service.resolveBatch(ORG_ID, BATCH_ID, SPEC, [candidate()]);

      expect(evaluate).not.toHaveBeenCalled();
      expect(reportSpy.mock.calls[0]?.[1]).toMatchObject({
        scope: 'mark_disambiguation.misconfigured',
      });
    });

    it('en live sin umbrales válidos no corre: todo queda para el humano', async () => {
      const { service, evaluate, updates } = makeService(
        'live',
        { jev: answer('B', 0.9), openai: answer('B', 0.9) },
        { overrides: { openai: { thresholds: { respuesta: { auto: 0.9, review: 0.5 } } } } },
      );

      await service.resolveBatch(ORG_ID, BATCH_ID, SPEC, [candidate()]);

      expect(evaluate).not.toHaveBeenCalled();
      expect(updates).toHaveLength(0);
      expect(reportSpy.mock.calls[0]?.[1]).toMatchObject({
        scope: 'mark_disambiguation.misconfigured',
      });
    });

    it('nunca lanza: una falla al leer la configuración se reporta', async () => {
      const { service, settingsOf } = makeService('live', { jev: null, openai: null });
      settingsOf.mockRejectedValueOnce(new Error('bd caída'));

      await expect(
        service.resolveBatch(ORG_ID, BATCH_ID, SPEC, [candidate()]),
      ).resolves.toBeUndefined();
      expect(reportSpy.mock.calls[0]?.[1]).toMatchObject({ scope: 'mark_disambiguation' });
    });
  });

  describe('sombra', () => {
    it('llama a shadow en ambos motores y solo escribe ai_resolution, sin tocar reviewed_*', async () => {
      const { service, shadow, evaluate, updates } = makeService('shadow', {
        jev: answer('B', 0.95),
        openai: answer('B', 0.9),
      });

      await service.resolveBatch(ORG_ID, BATCH_ID, SPEC, [candidate()]);

      expect(evaluate).not.toHaveBeenCalled();
      expect(shadow).toHaveBeenCalledTimes(2);
      const [, feature, request, options] = shadow.mock.calls[0] ?? [];
      if (!request) throw new Error('shadow no fue llamado');
      expect(feature).toBe('mark_disambiguation_jev');
      expect(request.images).toEqual([{ mimeType: 'image/jpeg', data: 'Y3JvcA==' }]);
      expect(JSON.stringify(request.state)).not.toMatch(/alumno.*Pérez|studentId|rut/i);
      expect(options).toEqual({
        correlationId: NOT_AUDITED,
        baseline: {
          state: 'ambiguous',
          doubtReason: 'margin',
          suggestedValue: 'B',
          nullConfidence: null,
          fill: 0.7,
          margin: 0.3,
          fieldId: 'q1',
          autoAnnulled: false,
        },
      });
      expect(shadow.mock.calls[1]?.[1]).toBe('mark_disambiguation_openai');

      expect(updates).toHaveLength(1);
      expect(Object.keys(updates[0]?.set ?? {})).toEqual(['aiResolution']);
      expect(updates[0]?.where).toContain('"ai_resolution" is null');
      expect(resolutionOf(updates[0])).toMatchObject({
        version: 'mark-disambiguation-v1',
        mode: 'shadow',
        verdict: 'agree',
        route: 'auto',
        value: 'B',
        applied: false,
        thresholds: { jev: JEV_THRESHOLDS, openai: OPENAI_THRESHOLDS },
        engines: [
          { feature: 'mark_disambiguation_jev', engine: 'jev', choice: 'B', confidence: 0.95 },
          { feature: 'mark_disambiguation_openai', engine: 'openai', choice: 'B', confidence: 0.9 },
        ],
      });
    });

    it('incluye las auto-anuladas por el OMR y no aplica auditoría', async () => {
      const { service, shadow, updates } = makeService('shadow', {
        jev: answer('null', 0.95),
        openai: answer('null', 0.9),
      });

      await service.resolveBatch(ORG_ID, BATCH_ID, SPEC, [
        candidate({ markId: AUDITED, state: 'multiple', autoAnnulled: true }),
      ]);

      expect(shadow).toHaveBeenCalledTimes(2);
      expect(resolutionOf(updates[0])).toMatchObject({ verdict: 'agree', route: 'auto' });
    });

    it('una sombra descartada (null) cuenta como falla de motor: dropped', async () => {
      const { service, updates } = makeService('shadow', { jev: answer('B', 0.99), openai: null });

      await service.resolveBatch(ORG_ID, BATCH_ID, SPEC, [candidate()]);

      expect(resolutionOf(updates[0])).toMatchObject({
        verdict: 'engine_failed',
        route: 'review',
        value: null,
        engines: [{ choice: 'B' }, { choice: null, errorCode: 'dropped', model: 'gpt-6-luna' }],
      });
    });

    it('sin umbrales en sombra registra igual, con veredicto no_thresholds', async () => {
      const { service, updates } = makeService(
        'shadow',
        { jev: answer('B', 0.99), openai: answer('B', 0.99) },
        { overrides: { jev: { thresholds: {} } } },
      );

      await service.resolveBatch(ORG_ID, BATCH_ID, SPEC, [candidate()]);

      expect(resolutionOf(updates[0])).toMatchObject({
        verdict: 'no_thresholds',
        route: 'review',
        value: null,
        thresholds: { jev: null, openai: OPENAI_THRESHOLDS },
      });
    });
  });

  describe('live', () => {
    it('aplica la automática como decisión de IA sin pisar una decisión previa', async () => {
      const { service, evaluate, updates } = makeService('live', {
        jev: answer('B', 0.95),
        openai: answer('B', 0.9),
      });

      await service.resolveBatch(ORG_ID, BATCH_ID, SPEC, [candidate()]);

      expect(evaluate).toHaveBeenCalledTimes(2);
      expect(evaluate.mock.calls[0]?.[2]).toMatchObject({ timeoutMs: 8_000 });
      expect(updates).toHaveLength(1);
      expect(updates[0]?.set).toMatchObject({
        reviewDecision: 'option',
        reviewedValue: 'B',
        reviewedById: null,
        autoResolved: true,
      });
      expect(updates[0]?.set.reviewedAt).toBeInstanceOf(Date);
      expect(resolutionOf(updates[0])).toMatchObject({ mode: 'live', applied: true, value: 'B' });
      expect(updates[0]?.where).toContain('"reviewed_at" is null');
      expect(updates[0]?.where).toContain('"ai_resolution" is null');
      expect(updates[0]?.where).toContain('"org_id" = $');
    });

    it('si la marca ya tenía decisión (0 filas), solo guarda la evidencia con applied=false', async () => {
      const { service, updates } = makeService(
        'live',
        { jev: answer('blank', 0.95), openai: answer('blank', 0.9) },
        { updateReturning: [[]] },
      );

      await service.resolveBatch(ORG_ID, BATCH_ID, SPEC, [candidate()]);

      expect(updates).toHaveLength(2);
      expect(Object.keys(updates[1]?.set ?? {})).toEqual(['aiResolution']);
      expect(resolutionOf(updates[1])).toMatchObject({ applied: false, verdict: 'agree' });
    });

    it('traduce blank y null a las decisiones de la marca', async () => {
      const blank = makeService('live', {
        jev: answer('blank', 0.95),
        openai: answer('blank', 0.9),
      });
      await blank.service.resolveBatch(ORG_ID, BATCH_ID, SPEC, [candidate()]);
      expect(blank.updates[0]?.set).toMatchObject({ reviewDecision: 'blank', reviewedValue: null });

      const nula = makeService('live', { jev: answer('null', 0.9), openai: answer('B', 0.3) });
      await nula.service.resolveBatch(ORG_ID, BATCH_ID, SPEC, [candidate({ state: 'multiple' })]);
      expect(nula.updates[0]?.set).toMatchObject({
        reviewDecision: 'annulled',
        reviewedValue: null,
      });
      expect(resolutionOf(nula.updates[0])).toMatchObject({ verdict: 'solo_a', applied: true });
    });

    it('excluye las auto-anuladas por el OMR', async () => {
      const { service, evaluate } = makeService('live', {
        jev: answer('null', 0.95),
        openai: answer('null', 0.9),
      });

      await service.resolveBatch(ORG_ID, BATCH_ID, SPEC, [
        candidate({ state: 'multiple', autoAnnulled: true }),
      ]);

      expect(evaluate).not.toHaveBeenCalled();
    });

    it('con un motor caído la marca va a revisión aunque el otro esté seguro', async () => {
      const { service, updates } = makeService('live', {
        jev: answer('B', 0.99),
        openai: new DecisionError('rate_limited', 'lento'),
      });

      await service.resolveBatch(ORG_ID, BATCH_ID, SPEC, [candidate()]);

      expect(updates).toHaveLength(1);
      expect(Object.keys(updates[0]?.set ?? {})).toEqual(['aiResolution']);
      expect(resolutionOf(updates[0])).toMatchObject({
        verdict: 'engine_failed',
        route: 'review',
        applied: false,
        engines: [{ errorCode: null }, { errorCode: 'rate_limited' }],
      });
    });

    it('conflicto: los motores no coinciden y la marca queda para el humano', async () => {
      const { service, updates } = makeService('live', {
        jev: answer('null', 0.83),
        openai: answer('B', 0.46),
      });

      await service.resolveBatch(ORG_ID, BATCH_ID, SPEC, [candidate({ state: 'multiple' })]);

      expect(Object.keys(updates[0]?.set ?? {})).toEqual(['aiResolution']);
      expect(resolutionOf(updates[0])).toMatchObject({ verdict: 'conflict', value: null });
    });

    it('veta "en blanco" cuando el OMR vio una doble marca', async () => {
      const { service, updates } = makeService('live', {
        jev: answer('blank', 0.99),
        openai: answer('blank', 0.99),
      });

      await service.resolveBatch(ORG_ID, BATCH_ID, SPEC, [candidate({ state: 'multiple' })]);

      expect(Object.keys(updates[0]?.set ?? {})).toEqual(['aiResolution']);
      expect(resolutionOf(updates[0])).toMatchObject({
        verdict: 'vetoed',
        route: 'review',
        value: 'blank',
      });
    });

    it('auditoría ciega determinista: el mismo markId siempre vuelve a revisión', async () => {
      for (let run = 0; run < 2; run++) {
        const { service, updates } = makeService('live', {
          jev: answer('B', 0.99),
          openai: answer('B', 0.99),
        });
        await service.resolveBatch(ORG_ID, BATCH_ID, SPEC, [candidate({ markId: AUDITED })]);
        expect(Object.keys(updates[0]?.set ?? {})).toEqual(['aiResolution']);
        expect(resolutionOf(updates[0])).toMatchObject({
          verdict: 'audit_sample',
          route: 'review',
          value: 'B',
          applied: false,
        });
      }
    });
  });

  describe('filtro de marcas', () => {
    it('excluye campos que no son bubble_group simple de una fila, y escaneos rechazados', async () => {
      const spec = specWith([
        bubbleField('digit', { kind: 'digit_grid' }),
        bubbleField('multi', { selectMode: 'multiple' }),
        bubbleField('dos-filas', {
          bubbles: [
            { value: 'A', center: { x: 0.2, y: 0.5 }, radius: 0.01 },
            { value: 'B', center: { x: 0.25, y: 0.6 }, radius: 0.01 },
          ],
        }),
        bubbleField('q1'),
      ]);
      const { service, shadow } = makeService('shadow', {
        jev: answer('B', 0.9),
        openai: answer('B', 0.9),
      });

      await service.resolveBatch(ORG_ID, BATCH_ID, spec, [
        candidate({ markId: markIdAt(1), fieldId: 'digit' }),
        candidate({ markId: markIdAt(2), fieldId: 'multi' }),
        candidate({ markId: markIdAt(3), fieldId: 'dos-filas' }),
        candidate({ markId: markIdAt(4), fieldId: 'q1', scanState: 'quality_rejected' }),
        candidate({ markId: markIdAt(5), fieldId: 'q1', scanState: 'superseded' }),
        candidate({ markId: markIdAt(6), fieldId: 'q1', state: 'marked' }),
        candidate({ markId: markIdAt(7), fieldId: 'q1', scanState: 'identity_unresolved' }),
      ]);

      expect(shadow).toHaveBeenCalledTimes(2);
      expect(shadow.mock.calls[0]?.[3].correlationId).toBe(markIdAt(7));
    });

    it('excluye y reporta un campo cuyos rótulos chocan con blank o null', async () => {
      const spec = specWith([
        bubbleField('q1', {
          bubbles: [
            { value: 'A', center: { x: 0.2, y: 0.5 }, radius: 0.01 },
            { value: 'blank', center: { x: 0.25, y: 0.5 }, radius: 0.01 },
          ],
        }),
      ]);
      const { service, shadow } = makeService('shadow', {
        jev: answer('A', 0.9),
        openai: answer('A', 0.9),
      });

      await service.resolveBatch(ORG_ID, BATCH_ID, spec, [candidate()]);

      expect(shadow).not.toHaveBeenCalled();
      expect(reportSpy.mock.calls[0]?.[1]).toMatchObject({
        scope: 'mark_disambiguation.reserved_value_collision',
        fieldIds: ['q1'],
      });
    });

    it('guardia de identidad: excluye y reporta un campo que se cruza con la zona de identidad', async () => {
      const spec = specWith([
        bubbleField('q1', {
          bubbles: ['A', 'B'].map((value, index) => ({
            value,
            center: { x: 0.8 + index * 0.05, y: 0.1 },
            radius: 0.01,
          })),
        }),
        bubbleField('q2'),
      ]);
      const { service, shadow } = makeService('shadow', {
        jev: answer('A', 0.9),
        openai: answer('A', 0.9),
      });

      await service.resolveBatch(ORG_ID, BATCH_ID, spec, [
        candidate({ fieldId: 'q1' }),
        candidate({ markId: markIdAt(9), fieldId: 'q2' }),
      ]);

      expect(shadow).toHaveBeenCalledTimes(2);
      expect(shadow.mock.calls[0]?.[3].correlationId).toBe(markIdAt(9));
      expect(reportSpy).toHaveBeenCalledTimes(1);
      expect(reportSpy.mock.calls[0]?.[1]).toMatchObject({
        scope: 'mark_disambiguation.identity_overlap',
        fieldIds: ['q1'],
      });
    });
  });

  describe('catch-up desde la BD', () => {
    it('evalúa las marcas sin ai_resolution que no están en memoria, con la imagen por URL', async () => {
      const fileRow = { id: 'file-1', storageKey: 'k', fileName: 'r.jpg', mimeType: 'image/jpeg' };
      const { service, evaluate, buildDownloadUrl, updates } = makeService(
        'live',
        { jev: answer('C', 0.95), openai: answer('C', 0.9) },
        {
          selectRows: [
            [
              {
                markId: NOT_AUDITED,
                fieldId: 'q1',
                state: 'ambiguous',
                fill: '0.700',
                margin: '0.300',
                suggestedValue: null,
                doubtReason: 'band',
                nullConfidence: null,
                autoResolved: false,
                reviewedById: null,
                reviewDecision: null,
                file: fileRow,
              },
              {
                markId: markIdAt(2),
                fieldId: 'q2',
                state: 'ambiguous',
                fill: '0.700',
                margin: '0.300',
                suggestedValue: null,
                doubtReason: 'band',
                nullConfidence: null,
                autoResolved: false,
                reviewedById: null,
                reviewDecision: null,
                file: fileRow,
              },
            ],
          ],
        },
      );

      await service.resolveBatch(ORG_ID, BATCH_ID, SPEC, [
        candidate({ markId: markIdAt(2), fieldId: 'q2' }),
      ]);

      expect(buildDownloadUrl).toHaveBeenCalledWith(fileRow, 'inline');
      const requests = evaluate.mock.calls.map((call) => call[2]);
      expect(requests.map((r) => r.images[0])).toEqual(
        expect.arrayContaining([
          { mimeType: 'image/jpeg', data: 'Y3JvcA==' },
          { url: 'https://s3.example/recorte.jpg?firma=1' },
        ]),
      );
      expect(evaluate).toHaveBeenCalledTimes(4);
      expect(updates).toHaveLength(2);
    });
  });

  describe('plazo del lote', () => {
    it('al vencer el plazo aborta las llamadas y no persiste nada', async () => {
      jest.useFakeTimers();
      const { service, evaluate, updates } = makeService('live', {
        jev: answer('B', 0.95),
        openai: answer('B', 0.95),
      });
      evaluate.mockImplementation(
        (_orgId, _feature, request) =>
          new Promise((_resolve, reject) => {
            request.signal.addEventListener('abort', () =>
              reject(new DecisionError('aborted', 'plazo vencido')),
            );
          }),
      );

      const done = service.resolveBatch(ORG_ID, BATCH_ID, SPEC, [
        candidate(),
        candidate({ markId: markIdAt(3), fieldId: 'q2' }),
      ]);
      await jest.advanceTimersByTimeAsync(MARK_DISAMBIGUATION_BATCH_DEADLINE_MS + 1);
      await done;

      expect(evaluate).toHaveBeenCalled();
      expect(updates).toHaveLength(0);
    });
  });
});
