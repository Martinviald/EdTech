import type { USER_ROLES } from '@soe/types';
import type { DefaultSession } from 'next-auth';

type UserRole = (typeof USER_ROLES)[number];

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      orgId: string | null;
      role: UserRole;
      isPlatformAdmin: boolean;
    } & DefaultSession['user'];
  }

  interface User {
    orgId?: string | null;
    role?: UserRole;
    isPlatformAdmin?: boolean;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    userId?: string;
    orgId?: string | null;
    role?: UserRole;
    isPlatformAdmin?: boolean;
  }
}
