import { Body, Controller, ForbiddenException, Get, Headers, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { switchOrgSchema, switchRoleSchema } from '@soe/types';
import { AuthService } from './auth.service';
import { CurrentUser } from './current-user.decorator';
import type { JwtPayload } from './jwt-payload.types';
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

  /**
   * POST /api/auth/switch-role — cambia el rol activo del usuario.
   * Requiere autenticación (no @Public). El AuthGuard valida el JWT y
   * pasa el JwtPayload via @CurrentUser. El controller no re-emite el
   * token; el frontend (NextAuth update()) lo persiste en el JWT.
   */
  @Post('switch-role')
  switchRole(@Body() body: unknown, @CurrentUser() user: JwtPayload) {
    const dto = switchRoleSchema.parse(body);
    return this.authService.switchActiveRole(user, dto.role);
  }

  /**
   * POST /api/auth/switch-org — cambia la org activa del usuario multi-org.
   * Requiere autenticación. Revalida el membership contra la BD y devuelve los
   * roles/activeRole de la org destino; el frontend los persiste vía
   * NextAuth update({ activeOrg }).
   */
  @Post('switch-org')
  switchOrg(@Body() body: unknown, @CurrentUser() user: JwtPayload) {
    const dto = switchOrgSchema.parse(body);
    return this.authService.switchActiveOrg(user, dto.orgId);
  }
}
