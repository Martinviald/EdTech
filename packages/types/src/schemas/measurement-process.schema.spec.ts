import {
  createMeasurementProcessSchema,
  linkProcessAssessmentsSchema,
  measurementProcessListQuerySchema,
  updateMeasurementProcessSchema,
} from './measurement-process.schema';

const YEAR_ID = '6f1c2b0e-8a4d-4c3b-9f2e-1a2b3c4d5e6f';
const ASSESSMENT_ID = '0b9e7c1a-2d3f-4e5a-8b6c-7d8e9f0a1b2c';

describe('esquemas de procesos de medición', () => {
  it('crear acepta las claves conocidas y rechaza una desconocida', () => {
    const valid = { name: 'DIA Intermedio 2026', academicYearId: YEAR_ID, kind: 'dia' };
    expect(createMeasurementProcessSchema.safeParse(valid).success).toBe(true);
    expect(createMeasurementProcessSchema.safeParse({ ...valid, slug: 'otro' }).success).toBe(
      false,
    );
  });

  it('actualizar sigue siendo parcial y estricto, y no acepta el año académico', () => {
    expect(updateMeasurementProcessSchema.safeParse({ name: 'Nuevo nombre' }).success).toBe(true);
    expect(updateMeasurementProcessSchema.safeParse({ slug: 'otro' }).success).toBe(false);
    expect(updateMeasurementProcessSchema.safeParse({ academicYearId: YEAR_ID }).success).toBe(
      false,
    );
    expect(updateMeasurementProcessSchema.safeParse({}).success).toBe(false);
  });

  it('el listado rechaza un filtro que no declara', () => {
    expect(measurementProcessListQuerySchema.safeParse({ academicYearId: YEAR_ID }).success).toBe(
      true,
    );
    expect(measurementProcessListQuerySchema.safeParse({ pageSize: '10' }).success).toBe(false);
  });

  it('vincular rechaza una clave desconocida', () => {
    expect(linkProcessAssessmentsSchema.safeParse({ assessmentIds: [ASSESSMENT_ID] }).success).toBe(
      true,
    );
    expect(
      linkProcessAssessmentsSchema.safeParse({ assessmentIds: [ASSESSMENT_ID], force: true })
        .success,
    ).toBe(false);
  });
});
