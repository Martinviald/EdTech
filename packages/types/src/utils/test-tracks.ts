/** Una línea de prueba tal como está en la BDD, reducida a lo que importa para resolverla. */
export type TestTrackRef = {
  id: string;
  orgId: string | null;
  subjectId: string;
  code: string;
};

/** Quién declara la línea: un instrumento (o una sección suya) con su asignatura y su org. */
export type TestTrackOwner = {
  label: string;
  subjectId: string | null;
  orgId: string | null;
};

export class TestTrackResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TestTrackResolutionError';
  }
}

export function indexTestTracksByCode(
  tracks: readonly TestTrackRef[],
): Map<string, TestTrackRef[]> {
  const byCode = new Map<string, TestTrackRef[]>();
  for (const track of tracks) {
    const bucket = byCode.get(track.code);
    if (bucket) bucket.push(track);
    else byCode.set(track.code, [track]);
  }
  return byCode;
}

/**
 * Resuelve el código de línea que declara un instrumento contra el catálogo.
 *
 * Reglas (las mismas que impone la BDD, pero con un mensaje legible antes de escribir):
 *  - el código tiene que existir entre las líneas visibles para el dueño (oficiales + las de su org);
 *  - un instrumento oficial (`orgId` null) solo puede apuntar a una línea oficial;
 *  - la línea tiene que ser de la misma asignatura que el instrumento.
 * Si el colegio tiene una línea propia con el mismo código y asignatura que una oficial, gana la propia.
 */
export function resolveTestTrack(
  code: string,
  owner: TestTrackOwner,
  tracksByCode: ReadonlyMap<string, readonly TestTrackRef[]>,
): TestTrackRef {
  const candidates = tracksByCode.get(code) ?? [];
  const visible = candidates.filter(
    (track) => track.orgId === null || (owner.orgId !== null && track.orgId === owner.orgId),
  );
  if (visible.length === 0) {
    if (owner.orgId === null && candidates.length > 0) {
      throw new TestTrackResolutionError(
        `${owner.label}: la línea "${code}" es privada de un colegio; un instrumento oficial solo puede usar líneas oficiales.`,
      );
    }
    throw new TestTrackResolutionError(
      `${owner.label}: la línea "${code}" no existe en el catálogo. Corre db:seed:test-tracks o corrige el código.`,
    );
  }
  if (owner.subjectId === null) {
    throw new TestTrackResolutionError(
      `${owner.label}: declara la línea "${code}" pero no tiene asignatura.`,
    );
  }
  const sameSubject = visible.filter((track) => track.subjectId === owner.subjectId);
  if (sameSubject.length === 0) {
    throw new TestTrackResolutionError(
      `${owner.label}: la línea "${code}" es de otra asignatura; una línea solo puede usarse en instrumentos de su asignatura.`,
    );
  }
  return sameSubject.find((track) => track.orgId !== null) ?? sameSubject[0]!;
}
