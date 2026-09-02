import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { createRemoteJWKSet, decodeJwt, jwtVerify, type JWTPayload } from 'jose';
import { McpPrincipalResolver } from './mcp-principal.resolver';

interface McpRequest {
  headers: Record<string, string | undefined>;
  user?: unknown;
}

@Injectable()
export class McpAuthGuard implements CanActivate {
  private readonly logger = new Logger('McpAuth');
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
      this.logger.warn('MCP auth: request sin bearer token');
      throw this.unauthorized(response, 'Token requerido', 'invalid_request', 'missing bearer token');
    }

    const issuer = this.config.get<string>('WORKOS_ISSUER');
    const jwksUrl = this.config.get<string>('WORKOS_JWKS_URL');
    const audience = this.config.get<string>('MCP_CANONICAL_URI');
    if (!issuer || !jwksUrl || !audience) {
      this.logger.error('MCP auth: faltan WORKOS_ISSUER / WORKOS_JWKS_URL / MCP_CANONICAL_URI');
      throw this.unauthorized(response, 'Authorization Server no configurado');
    }

    let payload: JWTPayload;
    try {
      this.jwks ??= createRemoteJWKSet(new URL(jwksUrl));
      ({ payload } = await jwtVerify(token, this.jwks, { issuer, audience }));
    } catch (error) {
      const detail = this.diagnose(token, issuer, audience, error);
      throw this.unauthorized(
        response,
        'Token inválido, expirado o emitido para otra audiencia',
        'invalid_token',
        detail,
      );
    }

    const emailClaim = payload['email'];
    if (typeof emailClaim !== 'string' || emailClaim.length === 0) {
      this.logger.warn(
        `MCP auth: token VÁLIDO pero SIN claim email (revisar JWT template en WorkOS). ` +
          `iss=${String(payload.iss)} aud=${JSON.stringify(payload.aud)} sub=${String(payload.sub)}`,
      );
      throw this.unauthorized(
        response,
        'Token sin claim email',
        'invalid_token',
        'missing email claim (revisar JWT template en WorkOS)',
      );
    }

    const principal = await this.resolver.resolve(emailClaim);
    if (!principal.isPlatformAdmin && !principal.features.includes('mcp')) {
      this.logger.warn(`MCP auth: feature 'mcp' no habilitada para org=${String(principal.orgId)}`);
      throw new ForbiddenException('El servidor MCP no está habilitado para tu organización');
    }
    this.logger.log(`MCP auth OK: user=${principal.userId} org=${String(principal.orgId)}`);
    request.user = principal;
    return true;
  }

  private diagnose(
    token: string,
    expectedIssuer: string,
    expectedAudience: string,
    error: unknown,
  ): string {
    let decoded: JWTPayload | undefined;
    try {
      decoded = decodeJwt(token);
    } catch {
      this.logger.warn('MCP auth rechazado: el bearer no es un JWT decodificable');
      return 'malformed token';
    }

    const code = (error as { code?: string }).code;
    const claim = (error as { claim?: string }).claim;
    const hasEmail = typeof decoded.email === 'string' && (decoded.email as string).length > 0;

    this.logger.warn(
      `MCP auth rechazado: ${JSON.stringify({
        expectedIssuer,
        expectedAudience,
        tokenIssuer: decoded.iss ?? null,
        tokenAudience: decoded.aud ?? null,
        hasEmail,
        joseCode: code ?? null,
        joseClaim: claim ?? null,
        message: error instanceof Error ? error.message : String(error),
      })}`,
    );

    if (code === 'ERR_JWT_EXPIRED') return 'token expired';
    if (claim === 'aud') {
      return `audience mismatch (expected ${expectedAudience}, got ${JSON.stringify(decoded.aud)})`;
    }
    if (claim === 'iss') {
      return `issuer mismatch (expected ${expectedIssuer}, got ${String(decoded.iss)})`;
    }
    if (code === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED' || code === 'ERR_JWKS_NO_MATCHING_KEY') {
      return 'invalid signature';
    }
    return `invalid token (${code ?? 'unknown'})`;
  }

  private unauthorized(
    response: Response,
    message: string,
    errorCode?: string,
    errorDescription?: string,
  ): UnauthorizedException {
    const parts: string[] = [];
    if (errorCode) parts.push(`error="${errorCode}"`);
    if (errorDescription) parts.push(`error_description="${errorDescription.replace(/"/g, "'")}"`);
    const canonicalUri = this.config.get<string>('MCP_CANONICAL_URI');
    if (canonicalUri) {
      const metadataUrl = `${new URL(canonicalUri).origin}/.well-known/oauth-protected-resource`;
      parts.push(`resource_metadata="${metadataUrl}"`);
    }
    if (parts.length > 0) {
      response.setHeader('WWW-Authenticate', `Bearer ${parts.join(', ')}`);
    }
    return new UnauthorizedException(message);
  }

  private extractToken(request: McpRequest): string | undefined {
    const [type, token] = request.headers['authorization']?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
