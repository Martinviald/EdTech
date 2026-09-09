import { TEACHING_ROLES, canReceiveTeachingLoad } from './teacher-assignments';

describe('canReceiveTeachingLoad', () => {
  it('acepta a un docente simple', () => {
    expect(canReceiveTeachingLoad(['teacher'])).toBe(true);
  });

  it('acepta a un profesor jefe y a un coordinador de evaluación', () => {
    expect(canReceiveTeachingLoad(['homeroom_teacher'])).toBe(true);
    expect(canReceiveTeachingLoad(['eval_coordinator'])).toBe(true);
  });

  // El caso que motivó el fix: 6 personas reales en la demo.
  it('acepta a un director académico que ADEMÁS hace clases', () => {
    expect(canReceiveTeachingLoad(['academic_director', 'teacher'])).toBe(true);
  });

  it('no depende del orden en que vengan los roles', () => {
    expect(canReceiveTeachingLoad(['teacher', 'academic_director'])).toBe(true);
    expect(canReceiveTeachingLoad(['academic_director', 'teacher'])).toBe(true);
  });

  it('acepta la combinación docente + profesor jefe (la mitad de la planta de CSCJ)', () => {
    expect(canReceiveTeachingLoad(['teacher', 'homeroom_teacher'])).toBe(true);
  });

  it('rechaza a quien no tiene NINGÚN rol docente', () => {
    expect(canReceiveTeachingLoad(['academic_director'])).toBe(false);
    expect(canReceiveTeachingLoad(['school_admin'])).toBe(false);
    expect(canReceiveTeachingLoad(['school_admin', 'academic_director'])).toBe(false);
  });

  it('rechaza una lista vacía (usuario sin membership activo en la org)', () => {
    expect(canReceiveTeachingLoad([])).toBe(false);
  });

  it('TEACHING_ROLES es la única fuente de la lista', () => {
    expect([...TEACHING_ROLES]).toEqual(['teacher', 'homeroom_teacher', 'eval_coordinator']);
  });
});
