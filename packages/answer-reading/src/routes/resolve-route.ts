import {
  DEFAULT_ORG_ANSWER_READING_SETTINGS,
  ROUTE_MATCH_LEVELS,
  type OrgAnswerReadingSettings,
  type ReaderSpec,
  type ReadingContext,
  type ReadingRoute,
  type ResolvedRoute,
  type ReviewReason,
  type RouteMatchLevel,
} from '@soe/types';

/** Ruta resuelta con sus lectores de respaldo (para aplicar las restricciones de la org). */
export type ResolvedRouteWithFallback = ResolvedRoute & {
  readonly fallbackReaders: readonly ReaderSpec[];
};

function matchesLevel(route: ReadingRoute, context: ReadingContext): boolean {
  const sameFormat = route.formatKind === context.responseFormat.kind;
  const formatAllowed = route.formatKind === null || sameFormat;
  const sameSubject = context.subjectId !== null && route.subjectId === context.subjectId;
  const sameGrade = context.gradeId !== null && route.gradeId === context.gradeId;
  const byLevel: Record<RouteMatchLevel, () => boolean> = {
    item: () => formatAllowed && route.itemId === context.itemId,
    instrument: () => formatAllowed && route.instrumentId === context.instrumentId,
    format_subject_grade: () => sameFormat && sameSubject && sameGrade,
    format_subject: () => sameFormat && sameSubject,
    format: () => sameFormat,
    default: () => true,
  };
  return byLevel[route.level]();
}

function compareRoutes(a: ReadingRoute, b: ReadingRoute): number {
  const level = ROUTE_MATCH_LEVELS.indexOf(a.level) - ROUTE_MATCH_LEVELS.indexOf(b.level);
  if (level !== 0) return level;
  const orgFirst = Number(a.orgId === null) - Number(b.orgId === null);
  if (orgFirst !== 0) return orgFirst;
  if (a.version !== b.version) return b.version - a.version;
  return a.id.localeCompare(b.id);
}

/**
 * Elige la ruta de lectura (diseño §6.4): solo rutas `active` de la org o globales;
 * precedencia item > instrument > format+subject+grade > format+subject > format >
 * default; en el mismo nivel la org gana a la global. Una ruta de ítem o de
 * instrumento con `formatKind` solo aplica si coincide con el formato del ítem.
 * `null` si ninguna aplica.
 */
export function resolveReadingRoute(
  context: ReadingContext,
  routes: readonly ReadingRoute[],
): ResolvedRouteWithFallback | null {
  const best = routes
    .filter((route) => route.status === 'active')
    .filter((route) => route.orgId === null || route.orgId === context.orgId)
    .filter((route) => matchesLevel(route, context))
    .sort(compareRoutes)[0];
  if (!best) return null;
  return {
    routeId: best.id,
    routeVersion: best.version,
    matchedLevel: best.level,
    readers: best.readers,
    shadowReaders: best.shadowReaders,
    policy: best.policy,
    fallbackReaders: best.fallbackReaders,
  };
}

export interface RestrictedRoute {
  readonly route: ResolvedRoute;
  /** Motivo para dejar la casilla como `not_read` si no quedaron lectores suficientes. */
  readonly notReadReason: Extract<
    ReviewReason,
    'external_vision_disabled' | 'insufficient_readers'
  > | null;
}

function enoughReaders(readers: readonly ReaderSpec[], route: ResolvedRoute): boolean {
  if (readers.length < route.policy.minReaders) return false;
  if (!route.policy.requireDistinctFamilies) return true;
  return new Set(readers.map((reader) => reader.family)).size >= route.policy.minReaders;
}

function completeWithFallback(
  readers: readonly ReaderSpec[],
  fallback: readonly ReaderSpec[],
  route: ResolvedRoute,
): ReaderSpec[] {
  const chosen = [...readers];
  const families = new Set(chosen.map((reader) => reader.family));
  for (const reader of fallback) {
    if (enoughReaders(chosen, route)) break;
    if (chosen.some((existing) => existing.key === reader.key)) continue;
    if (route.policy.requireDistinctFamilies && families.has(reader.family)) continue;
    chosen.push(reader);
    families.add(reader.family);
  }
  return chosen;
}

/**
 * Restricciones de la organización (diseño §6.4 y §14.3). No son rutas: se aplican
 * después. `allowExternalVision: false` deja la ruta sin lectores; los proveedores
 * no permitidos se quitan y, si no alcanzan, se completan con `fallbackReaders`.
 * `reviewAll` endurece la política (nada se autoacepta). Nunca la relaja. Un lector
 * de desempate no permitido se quita y el desacuerdo pasa a revisión.
 */
export function isProviderAllowedByOrg(
  settings: OrgAnswerReadingSettings,
  provider: string,
): boolean {
  const allowExternalVision =
    settings.allowExternalVision ?? DEFAULT_ORG_ANSWER_READING_SETTINGS.allowExternalVision;
  if (!allowExternalVision) return false;
  const allowedProviders: readonly string[] | undefined = settings.allowedProviders;
  return allowedProviders === undefined || allowedProviders.includes(provider);
}

export function applyOrgRestrictions(
  route: ResolvedRouteWithFallback,
  settings: OrgAnswerReadingSettings,
): RestrictedRoute {
  const { fallbackReaders, ...resolved } = route;
  const allowExternalVision =
    settings.allowExternalVision ?? DEFAULT_ORG_ANSWER_READING_SETTINGS.allowExternalVision;
  const allowed = (reader: ReaderSpec) => isProviderAllowedByOrg(settings, reader.provider);
  const tiebreak = resolved.policy.tiebreakReader;
  const withoutTiebreak =
    tiebreak !== null && !allowed(tiebreak)
      ? { ...resolved.policy, tiebreakReader: null, onDisagreement: 'review' as const }
      : resolved.policy;
  const policy = settings.reviewAll ? { ...withoutTiebreak, autoAccept: false } : withoutTiebreak;
  const strict: ResolvedRoute = { ...resolved, policy };
  if (!allowExternalVision) {
    return {
      route: { ...strict, readers: [], shadowReaders: [] },
      notReadReason: 'external_vision_disabled',
    };
  }
  const readers = completeWithFallback(
    strict.readers.filter(allowed),
    fallbackReaders.filter(allowed),
    strict,
  );
  const shadowReaders = strict.shadowReaders.filter(allowed);
  if (!enoughReaders(readers, strict)) {
    return {
      route: { ...strict, readers: [], shadowReaders },
      notReadReason: 'insufficient_readers',
    };
  }
  return { route: { ...strict, readers, shadowReaders }, notReadReason: null };
}
