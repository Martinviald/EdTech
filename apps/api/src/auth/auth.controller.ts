import { Body, Controller, ForbiddenException, Get, Headers, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { Public } from '../common/decorators/public.decorator';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {}

  private verifyInternalToken(token: string | undefined): void {
    const expected = this.config.getOrThrow<string>('INTERNAL_API_SECRET');
    if (!token || token !== expected) {
      throw new ForbiddenException('Token interno inválido');
    }
  }

  /** POST /api/auth/validate-user — valida email en signIn callback de NextAuth. */
  @Public()
  @Post('validate-user')
  async validateUser(
    @Headers('x-internal-token') token: string | undefined,
    @Body() body: { email: string },
  ) {
    this.verifyInternalToken(token);
    return this.authService.validateUser(body.email);
  }

  /** POST /api/auth/sync-user — sincroniza datos SSO del usuario en jwt callback. */
  @Public()
  @Post('sync-user')
  async syncUser(
    @Headers('x-internal-token') token: string | undefined,
    @Body()
    body: {
      userId: string;
      name: string;
      avatarUrl: string | null;
      provider: 'google' | 'microsoft';
      providerId: string;
    },
  ) {
    this.verifyInternalToken(token);
    await this.authService.syncUser(body);
    return { ok: true };
  }

  /** POST /api/auth/promote-invitation — convierte una invitación pendiente en miembro real. */
  @Public()
  @Post('promote-invitation')
  async promoteInvitation(
    @Headers('x-internal-token') token: string | undefined,
    @Body()
    body: {
      membershipId: string;
      email: string;
      name: string;
      avatarUrl: string | null;
      provider: 'google' | 'microsoft';
      providerId: string;
    },
  ) {
    this.verifyInternalToken(token);
    return this.authService.promoteInvitation(body);
  }

  /** GET /api/auth/mock-users — lista usuarios para el login mock (AUTH_MODE=mock). */
  @Public()
  @Get('mock-users')
  async listMockUsers(@Headers('x-internal-token') token: string | undefined) {
    this.verifyInternalToken(token);
    const authMode = this.config.get<string>('AUTH_MODE');
    return this.authService.listMockUsers(authMode);
  }
}
