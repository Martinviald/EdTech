import { bulkInviteMembersSchema, inviteMemberSchema } from './membership.schema';

/**
 * El contrato que fija este archivo: `name` es OPCIONAL en el schema y REQUERIDO en el
 * modal de /equipo. La distinción no es cosmética — decide si la invitación crea la fila
 * en `users` (y por lo tanto si la persona puede recibir carga académica) o queda como
 * membership pendiente. Si alguien vuelve `name` obligatorio acá, rompe el import masivo
 * por CSV, que sólo trae `email,role`.
 */
describe('inviteMemberSchema', () => {
  it('acepta una invitación con nombre', () => {
    const parsed = inviteMemberSchema.parse({
      name: 'Javiera González',
      email: 'jgonzalez@cscj.cl',
      role: 'teacher',
    });
    expect(parsed).toEqual({
      name: 'Javiera González',
      email: 'jgonzalez@cscj.cl',
      role: 'teacher',
    });
  });

  it('acepta una invitación SIN nombre (ruta del import masivo por CSV)', () => {
    const parsed = inviteMemberSchema.parse({ email: 'j@cscj.cl', role: 'teacher' });
    expect(parsed.name).toBeUndefined();
    expect(parsed.email).toBe('j@cscj.cl');
  });

  it('normaliza el correo a minúsculas y sin espacios, como antes', () => {
    const parsed = inviteMemberSchema.parse({
      email: '  JGonzalez@CSCJ.cl ',
      role: 'teacher',
    });
    expect(parsed.email).toBe('jgonzalez@cscj.cl');
  });

  it('recorta los espacios del nombre', () => {
    const parsed = inviteMemberSchema.parse({
      name: '  Javiera González  ',
      email: 'j@cscj.cl',
      role: 'teacher',
    });
    expect(parsed.name).toBe('Javiera González');
  });

  it('rechaza un nombre de un solo carácter', () => {
    const result = inviteMemberSchema.safeParse({
      name: 'J',
      email: 'j@cscj.cl',
      role: 'teacher',
    });
    expect(result.success).toBe(false);
  });

  it('rechaza un nombre que es sólo espacios (no lo deja pasar como vacío)', () => {
    const result = inviteMemberSchema.safeParse({
      name: '   ',
      email: 'j@cscj.cl',
      role: 'teacher',
    });
    expect(result.success).toBe(false);
  });

  it('sigue rechazando un rol no asignable desde /equipo', () => {
    const result = inviteMemberSchema.safeParse({
      name: 'Alguien',
      email: 'a@cscj.cl',
      role: 'platform_admin',
    });
    expect(result.success).toBe(false);
  });

  it('el import masivo sigue aceptando filas sólo con email y rol', () => {
    const parsed = bulkInviteMembersSchema.parse({
      members: [
        { email: 'uno@cscj.cl', role: 'teacher' },
        { email: 'dos@cscj.cl', role: 'coordinator' },
      ],
    });
    expect(parsed.members).toHaveLength(2);
    expect(parsed.members[0]?.name).toBeUndefined();
  });

  it('el import masivo también acepta filas CON nombre (CSV extendido a futuro)', () => {
    const parsed = bulkInviteMembersSchema.parse({
      members: [{ name: 'Uno Uno', email: 'uno@cscj.cl', role: 'teacher' }],
    });
    expect(parsed.members[0]?.name).toBe('Uno Uno');
  });
});
