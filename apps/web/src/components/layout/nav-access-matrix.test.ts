import { USER_ROLES, type UserRole } from '@soe/types';
import { visibleNavGroups } from './nav-items';
import { accessibleHubOptions, ADMIN_HUB_OPTIONS } from './admin-hub';

// Matriz de acceso de la navegación: qué ve cada rol en el sidebar y en el hub de
// Administración. Es el oráculo contra pérdidas de acceso: cualquier cambio en el
// snapshot tiene que estar en la lista de cambios intencionales del diseño
// (docs/diseno/rediseno-navegacion.md §8).
function navigationFor(roles: readonly UserRole[], isPlatformAdmin: boolean) {
  return {
    sidebar: visibleNavGroups(roles).map((group) => ({
      group: group.label ?? `(${group.id})`,
      items: group.items.map((item) => item.label),
    })),
    hub: accessibleHubOptions(ADMIN_HUB_OPTIONS, roles, isPlatformAdmin).map(
      (option) => `${option.label}${option.status === 'soon' ? ' (próximamente)' : ''}`,
    ),
  };
}

describe('matriz de acceso de la navegación', () => {
  it.each(USER_ROLES.map((role) => [role]))('rol %s', (role) => {
    expect(navigationFor([role], false)).toMatchSnapshot();
  });

  it('platform_admin por tabla (ve todo el hub)', () => {
    expect(navigationFor(['platform_admin'], true)).toMatchSnapshot();
  });

  it('multi-rol teacher + eval_coordinator (unión)', () => {
    expect(navigationFor(['teacher', 'eval_coordinator'], false)).toMatchSnapshot();
  });
});
