import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { eq } from 'drizzle-orm';
import { organizations } from '@soe/db';
import { FEATURE_LABELS, isFeatureAllowed, type FeatureKey } from '@soe/types';
import { FEATURE_KEY } from '../decorators/feature.decorator';
import { InjectDb, type Database } from '../../database/database.types';
import type { JwtPayload } from '../../auth/jwt-payload.types';

/**
 * Gating de tier pago (H18.1). Si la ruta declara `@RequireFeature(...)`, verifica
 * que la org del usuario tenga esa feature habilitada en `organizations.config`.
 *
 * - `platform_admin` se exime (acceso a todo, igual que en RolesGuard).
 * - Sin `orgId` (platform_admin sin membership) y sin ser platform_admin → 403.
 * - `organizations` NO está bajo RLS → se lee con `this.db` directo por id.
 * - Política de default: si la org no tiene `allowedFeatures` configurado, la
 *   feature se considera habilitada (ver `isFeatureAllowed` en @soe/types).
 *
 * Se usa DESPUÉS de RolesGuard: `@UseGuards(RolesGuard, FeatureGuard)`.
 */
@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @InjectDb() private readonly db: Database,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const feature = this.reflector.getAllAndOverride<FeatureKey | undefined>(FEATURE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!feature) return true;

    const { user } = context.switchToHttp().getRequest<{ user: JwtPayload }>();
    if (user.isPlatformAdmin) return true;

    if (!user.orgId) {
      throw new ForbiddenException('Sin organización asociada para esta operación');
    }

    const [org] = await this.db
      .select({ config: organizations.config })
      .from(organizations)
      .where(eq(organizations.id, user.orgId));

    if (!isFeatureAllowed(org?.config, feature)) {
      throw new ForbiddenException(
        `La función "${FEATURE_LABELS[feature]}" no está habilitada en el plan de tu colegio`,
      );
    }
    return true;
  }
}
