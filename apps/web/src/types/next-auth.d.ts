import type { USER_ROLES } from '@soe/types';
import type { DefaultSession } from 'next-auth';

type UserRole = (typeof USER_ROLES)[number];

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      orgId: string;
      role: UserRole;
    } & DefaultSession['user'];
  }

  interface User {
    orgId?: string;
    role?: UserRole;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    userId?: string;
    orgId?: string;
    role?: UserRole;
  }
}
