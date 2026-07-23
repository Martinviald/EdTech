import NextAuth, { type NextAuthConfig, type User } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import Google from 'next-auth/providers/google';
import MicrosoftEntraID from 'next-auth/providers/microsoft-entra-id';
import { pickDefaultActiveRole, USER_ROLES, type UserRole } from '@soe/types';
import { authConfig } from '@/auth.config';
import { internalPost } from '@/lib/api';
import { ROUTES } from '@/lib/routes';

const authMode = process.env.AUTH_MODE === 'mock' ? 'mock' : 'sso';

if (process.env.NODE_ENV === 'production' && authMode === 'mock') {
  throw new Error('AUTH_MODE=mock is forbidden in production');
}

type ValidateUserResponse = {
  user: {
    id: string;
    email: string;
    name: string;
    avatarUrl: string | null;
    providerId: string;
  } | null;
  isPlatformAdmin: boolean;
  isPending: boolean;
  roles: UserRole[];
  activeRole: UserRole;
  /** @deprecated mantenido para no romper consumidores legacy. */
  membership: {
    id: string;
    userId: string | null;
    orgId: string | null;
    role: string;
    isActive: boolean;
  } | null;
  memberships: Array<{
    id: string;
    userId: string | null;
    orgId: string | null;
    role: UserRole;
    isActive: boolean;
  }>;
  organization: { id: string; name: string; type: string } | null;
  orgs: Array<{ id: string; name: string }>;
  orgName: string | null;
};

type PromoteInvitationResponse = {
  userId: string;
  membershipId: string;
  orgId: string;
  role: string;
  roles: UserRole[];
  activeRole: UserRole;
};

function normalizeRoles(raw: unknown): UserRole[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (r): r is UserRole => typeof r === 'string' && (USER_ROLES as readonly string[]).includes(r),
  );
}

function normalizeOrgs(raw: unknown): Array<{ id: string; name: string }> {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (o): o is { id: string; name: string } =>
      typeof o === 'object' &&
      o !== null &&
      typeof (o as { id?: unknown }).id === 'string' &&
      typeof (o as { name?: unknown }).name === 'string',
  );
}

function ssoProviders() {
  return [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
    MicrosoftEntraID({
      clientId: process.env.MICROSOFT_CLIENT_ID,
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
      issuer: `https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID ?? 'common'}/v2.0`,
    }),
  ];
}

function mockProvider() {
  return Credentials({
    id: 'mock',
    name: 'Mock Auth (dev only)',
    credentials: { email: { label: 'Email', type: 'email' } },
    async authorize(credentials) {
      const email = credentials?.email;
      if (typeof email !== 'string' || !email) return null;
      const result = await internalPost<ValidateUserResponse>('/auth/validate-user', { email });
      if (!result || !result.user) return null; // pending no soportado vía mock
      const roles = result.roles?.length
        ? result.roles
        : ([result.isPlatformAdmin ? 'platform_admin' : 'teacher'] as UserRole[]);
      const activeRole = result.activeRole ?? pickDefaultActiveRole(roles);
      return {
        id: result.user.id,
        email: result.user.email,
        name: result.user.name,
        image: result.user.avatarUrl ?? undefined,
        orgId: result.membership?.orgId ?? null,
        orgName: result.orgName ?? null,
        orgs: normalizeOrgs(result.orgs),
        roles,
        activeRole,
        role: activeRole,
        isPlatformAdmin: result.isPlatformAdmin,
      } satisfies User;
    },
  });
}

const config: NextAuthConfig = {
  ...authConfig,
  providers: authMode === 'mock' ? [mockProvider()] : ssoProviders(),
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ user, account, profile }) {
      if (account?.provider === 'mock') return true;

      const email = profile?.email ?? user.email;
      if (!email) return `${ROUTES.authError}?error=EmailNotWhitelisted`;

      const result = await internalPost<ValidateUserResponse>('/auth/validate-user', { email });
      if (!result) return `${ROUTES.authError}?error=EmailNotWhitelisted`;

      const dbProvider: 'google' | 'microsoft' =
        account?.provider === 'microsoft-entra-id' ? 'microsoft' : 'google';

      const avatarUrl =
        (profile as { picture?: string } | undefined)?.picture ?? user.image ?? null;

      // Caso A: invitación pendiente — crear users + rellenar user_id en el membership.
      if (result.isPending && result.membership) {
        const realName = profile?.name ?? user.name ?? email;
        const promoted = await internalPost<PromoteInvitationResponse>('/auth/promote-invitation', {
          membershipId: result.membership.id,
          email,
          name: realName,
          avatarUrl,
          provider: dbProvider,
          providerId: account?.providerAccountId ?? '',
        });
        const promotedRoles = promoted.roles?.length ? promoted.roles : [promoted.role as UserRole];
        const promotedActiveRole = promoted.activeRole ?? pickDefaultActiveRole(promotedRoles);
        user.id = promoted.userId;
        user.orgId = promoted.orgId;
        user.orgs = normalizeOrgs(result.orgs);
        user.orgName = result.orgName ?? null;
        user.roles = promotedRoles;
        user.activeRole = promotedActiveRole;
        user.role = promotedActiveRole;
        user.isPlatformAdmin = false;
        return true;
      }

      // Caso B: user real (incluye platform_admin con o sin membership).
      if (!result.user) return `${ROUTES.authError}?error=EmailNotWhitelisted`;

      const realName = profile?.name ?? user.name ?? result.user.name;
      await internalPost('/auth/sync-user', {
        userId: result.user.id,
        name: realName,
        avatarUrl,
        provider: dbProvider,
        providerId: account?.providerAccountId ?? result.user.providerId,
      });

      const roles = result.roles?.length
        ? result.roles
        : ([result.isPlatformAdmin ? 'platform_admin' : 'teacher'] as UserRole[]);
      const activeRole = result.activeRole ?? pickDefaultActiveRole(roles);

      user.id = result.user.id;
      user.orgId = result.membership?.orgId ?? null;
      user.orgs = normalizeOrgs(result.orgs);
      user.orgName = result.orgName ?? null;
      user.roles = roles;
      user.activeRole = activeRole;
      user.role = activeRole;
      user.isPlatformAdmin = result.isPlatformAdmin;
      return true;
    },
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.userId = user.id as string;
        token.orgId = (user.orgId ?? null) as string | null;
        token.orgName = (user.orgName ?? null) as string | null;
        token.orgs = normalizeOrgs(user.orgs);
        token.roles = user.roles ?? (user.role ? [user.role as UserRole] : []);
        token.activeRole = user.activeRole ?? (user.role as UserRole | undefined);
        token.role = token.activeRole;
        token.isPlatformAdmin = Boolean(user.isPlatformAdmin);
      }

      // Refresh disparado por `useSession().update({ activeRole })` desde el
      // RoleSwitcher. Validamos que el rol propuesto esté en token.roles —
      // defensa en profundidad; el endpoint /auth/switch-role ya validó.
      if (trigger === 'update' && session && typeof session === 'object') {
        const candidate = (session as { activeRole?: unknown }).activeRole;
        const valid = normalizeRoles(token.roles ?? []);
        if (
          typeof candidate === 'string' &&
          (USER_ROLES as readonly string[]).includes(candidate) &&
          valid.includes(candidate as UserRole)
        ) {
          token.activeRole = candidate as UserRole;
          token.role = candidate as UserRole;
        }

        // Refresh disparado por `useSession().update({ activeOrg })` desde el
        // OrgSwitcher. A diferencia del rol, cambiar de org recalcula los roles
        // (son por-org), así que el payload trae roles + activeRole frescos.
        // Validamos que la org destino esté entre las del token (el endpoint
        // /auth/switch-org ya revalidó contra la BD).
        const activeOrg = (session as { activeOrg?: unknown }).activeOrg;
        if (activeOrg && typeof activeOrg === 'object') {
          const {
            orgId,
            orgName,
            roles: newRolesRaw,
            activeRole: newActiveRaw,
          } = activeOrg as {
            orgId?: unknown;
            orgName?: unknown;
            roles?: unknown;
            activeRole?: unknown;
          };
          const knownOrgs = normalizeOrgs(token.orgs ?? []);
          if (typeof orgId === 'string' && knownOrgs.some((o) => o.id === orgId)) {
            const newRoles = normalizeRoles(newRolesRaw);
            token.orgId = orgId;
            token.orgName = typeof orgName === 'string' ? orgName : (token.orgName ?? null);
            if (newRoles.length > 0) {
              token.roles = newRoles;
              const nextActive =
                typeof newActiveRaw === 'string' &&
                (USER_ROLES as readonly string[]).includes(newActiveRaw) &&
                newRoles.includes(newActiveRaw as UserRole)
                  ? (newActiveRaw as UserRole)
                  : pickDefaultActiveRole(newRoles);
              token.activeRole = nextActive;
              token.role = nextActive;
            }
          }
        }
      }

      return token;
    },
    async session({ session, token }) {
      if (typeof token.userId === 'string') session.user.id = token.userId;
      session.user.orgId = (token.orgId ?? null) as string | null;
      session.user.orgName = (token.orgName ?? null) as string | null;
      session.user.orgs = normalizeOrgs(token.orgs ?? []);
      const roles = normalizeRoles(token.roles ?? []);
      const fallback = (token.role ?? token.activeRole) as UserRole | undefined;
      const resolvedRoles = roles.length > 0 ? roles : fallback ? [fallback] : [];
      session.user.roles = resolvedRoles;
      const active = (token.activeRole ?? fallback) as UserRole | undefined;
      if (active) {
        session.user.activeRole = active;
        session.user.role = active;
      }
      session.user.isPlatformAdmin = Boolean(token.isPlatformAdmin);
      return session;
    },
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(config);
