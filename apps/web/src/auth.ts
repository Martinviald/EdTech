import NextAuth, { type NextAuthConfig, type User } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import Google from 'next-auth/providers/google';
import MicrosoftEntraID from 'next-auth/providers/microsoft-entra-id';
import type { USER_ROLES } from '@soe/types';
import { authConfig } from '@/auth.config';
import { internalPost } from '@/lib/api';

type UserRole = (typeof USER_ROLES)[number];

const authMode = process.env.AUTH_MODE === 'mock' ? 'mock' : 'sso';

if (process.env.NODE_ENV === 'production' && authMode === 'mock') {
  throw new Error('AUTH_MODE=mock is forbidden in production');
}

type ValidateUserResponse = {
  user: { id: string; email: string; name: string; avatarUrl: string | null; providerId: string };
  membership: { userId: string; orgId: string; role: string; isActive: boolean };
  organization: { id: string; name: string; type: string };
};

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
      if (!result) return null;
      return {
        id: result.user.id,
        email: result.user.email,
        name: result.user.name,
        image: result.user.avatarUrl ?? undefined,
        orgId: result.membership.orgId,
        role: result.membership.role as UserRole,
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
      if (!email) return '/auth/error?error=EmailNotWhitelisted';

      const result = await internalPost<ValidateUserResponse>('/auth/validate-user', { email });
      if (!result) return '/auth/error?error=EmailNotWhitelisted';

      const dbProvider: 'google' | 'microsoft' =
        account?.provider === 'microsoft-entra-id' ? 'microsoft' : 'google';

      const avatarUrl =
        (profile as { picture?: string } | undefined)?.picture ?? user.image ?? null;
      const realName = profile?.name ?? user.name ?? result.user.name;

      await internalPost('/auth/sync-user', {
        userId: result.user.id,
        name: realName,
        avatarUrl,
        provider: dbProvider,
        providerId: account?.providerAccountId ?? result.user.providerId,
      });

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
