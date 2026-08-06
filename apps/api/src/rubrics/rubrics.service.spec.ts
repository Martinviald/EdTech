import { NotFoundException } from '@nestjs/common';
import type { JwtPayload } from '../auth/jwt-payload.types';
import type { Database } from '../database/database.types';
import { RubricsService } from './rubrics.service';

function makeDb(sequence: unknown[][]): Database {
  let idx = 0;
  const db = {
    select: () => {
      const rows = sequence[idx] ?? [];
      idx++;
      const link = (): unknown =>
        Object.assign(Promise.resolve(rows), {
          from: () => link(),
          where: () => link(),
          orderBy: () => link(),
          limit: () => Promise.resolve(rows),
        });
      return link();
    },
  };
  return db as unknown as Database;
}

const user = { orgId: 'org-1' } as JwtPayload;

describe('RubricsService', () => {
  it('ensambla la rúbrica con criterios y niveles anidados', async () => {
    const db = makeDb([
      [{ id: 'r-1', name: 'Pauta de escritura', type: 'analytic' }],
      [
        {
          id: 'c-1',
          name: 'Coherencia',
          description: 'Ideas ordenadas',
          maxPoints: '4.00',
          order: 0,
        },
        { id: 'c-2', name: 'Ortografía', description: null, maxPoints: '2.00', order: 1 },
      ],
      [
        { id: 'l-1', criterionId: 'c-1', score: '4.00', descriptor: 'Logrado', examples: ['ej'] },
        { id: 'l-2', criterionId: 'c-1', score: '0.00', descriptor: 'No logrado', examples: null },
        { id: 'l-3', criterionId: 'c-2', score: '2.00', descriptor: 'Sin errores', examples: null },
      ],
    ]);
    const service = new RubricsService(db);

    const rubric = await service.getById(user, 'r-1');

    expect(rubric.id).toBe('r-1');
    expect(rubric.type).toBe('analytic');
    expect(rubric.criteria).toHaveLength(2);
    expect(rubric.criteria[0]).toMatchObject({ name: 'Coherencia', maxPoints: 4 });
    expect(rubric.criteria[0].levels).toEqual([
      { id: 'l-1', score: 4, descriptor: 'Logrado', examples: ['ej'] },
      { id: 'l-2', score: 0, descriptor: 'No logrado', examples: null },
    ]);
    expect(rubric.criteria[1].levels).toHaveLength(1);
  });

  it('lanza NotFound si la rúbrica no existe o no es del tenant', async () => {
    const service = new RubricsService(makeDb([[]]));
    await expect(service.getById(user, 'r-x')).rejects.toBeInstanceOf(NotFoundException);
  });
});
