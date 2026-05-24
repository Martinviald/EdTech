import type { USER_ROLES } from '@soe/types';
import type { DefaultSession } from 'next-auth';

type UserRole = (typeof USER_ROLES)[number];

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      orgId: string | null;
      roles: UserRole[];
      activeRole: UserRole;
      /** @deprecated mirror de activeRole durante la migración multi-rol. */
      role: UserRole;
      isPlatformAdmin: boolean;
    } & DefaultSession['user'];
  }

  interface User {
    orgId?: string | null;
    roles?: UserRole[];
    activeRole?: UserRole;
    /** @deprecated mirror de activeRole. */
    role?: UserRole;
    isPlatformAdmin?: boolean;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    userId?: string;
    orgId?: string | null;
    roles?: UserRole[];
    activeRole?: UserRole;
    /** @deprecated mirror de activeRole. */
    role?: UserRole;
    isPlatformAdmin?: boolean;
  }
}
