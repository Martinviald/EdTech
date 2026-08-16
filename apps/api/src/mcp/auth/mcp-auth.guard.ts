import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { McpPrincipalResolver } from './mcp-principal.resolver';

interface McpRequest {
  headers: Record<string, string | undefined>;
  user?: unknown;
}

@Injectable()
export class McpAuthGuard implements CanActivate {
  private jwks?: ReturnType<typeof createRemoteJWKSet>;

  constructor(
    private readonly config: ConfigService,
    private readonly resolver: McpPrincipalResolver,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.config.get<string>('MCP_ENABLED', 'false') !== 'true') {
      throw new NotFoundException();
    }

    const http = context.switchToHttp();
    const request = http.getRequest<McpRequest>();
    const response = http.getResponse<Response>();

    const token = this.extractToken(request);
    if (!token) {
      throw this.unauthorized(response, 'Token requerido');
    }

    const issuer = this.config.get<string>('WORKOS_ISSUER');
    const jwksUrl = this.config.get<string>('WORKOS_JWKS_URL');
    const audience = this.config.get<string>('MCP_CANONICAL_URI');
    if (!issuer || !jwksUrl || !audience) {
      throw this.unauthorized(response, 'Authorization Server no configurado');
    }

    let email: string;
    try {
      this.jwks ??= createRemoteJWKSet(new URL(jwksUrl));
      const { payload } = await jwtVerify(token, this.jwks, { issuer, audience });
      const claim = payload['email'];
      if (typeof claim !== 'string' || claim.length === 0) {
        throw new Error('token sin claim email');
      }
      email = claim;
    } catch {
      throw this.unauthorized(response, 'Token inválido, expirado o emitido para otra audiencia');
    }

    const principal = await this.resolver.resolve(email);
    if (!principal.isPlatformAdmin && !principal.features.includes('mcp')) {
      throw new ForbiddenException('El servidor MCP no está habilitado para tu organización');
    }
    request.user = principal;
    return true;
  }

  private unauthorized(response: Response, message: string): UnauthorizedException {
    const canonicalUri = this.config.get<string>('MCP_CANONICAL_URI');
    if (canonicalUri) {
      const metadataUrl = `${new URL(canonicalUri).origin}/.well-known/oauth-protected-resource`;
      response.setHeader(
        'WWW-Authenticate',
        `Bearer resource_metadata="${metadataUrl}"`,
      );
    }
    return new UnauthorizedException(message);
  }

  private extractToken(request: McpRequest): string | undefined {
    const [type, token] = request.headers['authorization']?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
