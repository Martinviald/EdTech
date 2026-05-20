import NextAuth, { type NextAuthConfig, type User } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import Google from 'next-auth/providers/google';
import MicrosoftEntraID from 'next-auth/providers/microsoft-entra-id';
import { eq } from 'drizzle-orm';
import { findMembershipByEmail, schema } from '@soe/db';
import type { USER_ROLES } from '@soe/types';
import { authConfig } from '@/auth.config';
import { db } from '@/lib/db';

type UserRole = (typeof USER_ROLES)[number];

const authMode = process.env.AUTH_MODE === 'mock' ? 'mock' : 'sso';

if (process.env.NODE_ENV === 'production' && authMode === 'mock') {
  throw new Error('AUTH_MODE=mock is forbidden in production');
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
      const result = await findMembershipByEmail(db, email);
      if (!result) return null;
      return {
        id: result.user.id,
        email: result.user.email,
        name: result.user.name,
        image: result.user.avatarUrl ?? undefined,
        orgId: result.membership.orgId,
        role: result.membership.role,
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
      // Credentials (mock): authorize ya validó y cargó orgId/role.
      if (account?.provider === 'mock') return true;

      // OAuth: validar whitelist contra org_memberships por email.
      const email = profile?.email ?? user.email;
      if (!email) return '/auth/error?error=EmailNotWhitelisted';

      const result = await findMembershipByEmail(db, email);
      if (!result) return '/auth/error?error=EmailNotWhitelisted';

      // Mapeo del provider de Auth.js al enum DB ('google' | 'microsoft').
      const dbProvider: 'google' | 'microsoft' =
        account?.provider === 'microsoft-entra-id' ? 'microsoft' : 'google';

      // First-login sync: actualizar el users row (creado en seed o por CSV)
      // con los datos reales del proveedor.
      const avatarUrl =
        (profile as { picture?: string } | undefined)?.picture ?? user.image ?? null;
      const realName = profile?.name ?? user.name ?? result.user.name;

      await db
        .update(schema.users)
        .set({
          name: realName,
          avatarUrl,
          provider: dbProvider,
          providerId: account?.providerAccountId ?? result.user.providerId,
          lastLoginAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.users.id, result.user.id));

      // Inyectar claims que el callback `jwt` recoge en el primer call.
      user.id = result.user.id;
      user.orgId = result.membership.orgId;
      user.role = result.membership.role as UserRole;
      return true;
    },
    async jwt({ token, user }) {
      if (user) {
        token.userId = user.id as string;
        token.orgId = user.orgId as string;
        token.role = user.role as UserRole;
      }
      return token;
    },
    async session({ session, token }) {
      if (typeof token.userId === 'string') session.user.id = token.userId;
      if (typeof token.orgId === 'string') session.user.orgId = token.orgId;
      if (token.role) session.user.role = token.role as UserRole;
      return session;
    },
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(config);
