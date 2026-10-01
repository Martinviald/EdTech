import { USER_ROLES } from '../enums';
import { canAccess } from '../utils/roles';
import { ORG_PROFILE_VIEWER_ROLES } from './staff-org';

describe('ORG_PROFILE_VIEWER_ROLES', () => {
  it.each(USER_ROLES)(
    'un usuario con solo el rol %s puede leer el perfil que pide el layout',
    (role) => {
      expect(canAccess([role], ORG_PROFILE_VIEWER_ROLES)).toBe(true);
    },
  );
});
