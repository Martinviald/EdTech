import type { USER_ROLES } from '@soe/types';
import type { DefaultSession } from 'next-auth';

type UserRole = (typeof USER_ROLES)[number];

type OrgSummary = { id: string; name: string };

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      orgId: string | null;
      orgName: string | null;
      orgs: OrgSummary[];
      roles: UserRole[];
      activeRole: UserRole;
      /** @deprecated mirror de activeRole durante la migración multi-rol. */
      role: UserRole;
      isPlatformAdmin: boolean;
    } & DefaultSession['user'];
  }

  interface User {
    orgId?: string | null;
    orgName?: string | null;
    orgs?: OrgSummary[];
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
    orgName?: string | null;
    orgs?: OrgSummary[];
    roles?: UserRole[];
    activeRole?: UserRole;
    /** @deprecated mirror de activeRole. */
    role?: UserRole;
    isPlatformAdmin?: boolean;
  }
}
