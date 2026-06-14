import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  generateRemedialSchema,
  remedialListQuerySchema,
  reviewRemedialSchema,
  REMEDIAL_APPROVER_ROLES,
  REMEDIAL_GENERATOR_ROLES,
  REMEDIAL_VIEWER_ROLES,
  type RemedialListResponse,
  type RemedialMaterialModel,
  type RemedialStatus,
} from '@soe/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { JOB_DISPATCHER, type JobDispatcher } from '../jobs/job-dispatcher';
import { RemedialRunner } from './remedial.runner';
import { RemedialService } from './remedial.service';

/**
 * API del módulo de IA Remedial (F2 S3 — H9.1–H9.5). Validación Zod en cada
 * handler; autorización por las constantes de roles de `@soe/types`. La
 * generación se encola vía el puerto `JOB_DISPATCHER` (async); el frontend hace
 * polling con `GET /:id`. `orgId` SIEMPRE del token (en el service).
 */
@Controller('remedial')
@UseGuards(RolesGuard)
export class RemedialController {
  constructor(
    private readonly service: RemedialService,
    private readonly runner: RemedialRunner,
    @Inject(JOB_DISPATCHER) private readonly dispatcher: JobDispatcher,
  ) {}

  /**
   * POST /api/remedial/generate
   *
   * Crea (o reutiliza desde caché) el material. Si no proviene de caché, encola la
   * generación async. Responde `{ materialId, status }` para polling.
   */
  @Post('generate')
  @Roles(...REMEDIAL_GENERATOR_ROLES)
  async generate(
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ): Promise<{ materialId: string; status: RemedialStatus }> {
    const dto = generateRemedialSchema.parse(body);
    const { material, fromCache } = await this.service.create(user, dto);

    if (!fromCache) {
      const { id: materialId, orgId } = material; // del Model ya creado (orgId del token)
      this.dispatcher.enqueue({
        id: materialId,
        kind: 'remedial',
        run: () => this.runner.run(materialId, orgId),
      });
    }

    return { materialId: material.id, status: material.status };
  }

  /** GET /api/remedial/:id — poll del estado/salida del material. */
  @Get(':id')
  @Roles(...REMEDIAL_VIEWER_ROLES)
  get(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<RemedialMaterialModel> {
    return this.service.get(user, id);
  }

  /** GET /api/remedial — banco de material remedial paginado/filtrado. */
  @Get()
  @Roles(...REMEDIAL_VIEWER_ROLES)
  list(
    @Query() query: unknown,
    @CurrentUser() user: JwtPayload,
  ): Promise<RemedialListResponse> {
    const dto = remedialListQuerySchema.parse(query);
    return this.service.list(user, dto);
  }

  /** PATCH /api/remedial/:id/review — aprobar/descartar (H9.5). */
  @Patch(':id/review')
  @Roles(...REMEDIAL_APPROVER_ROLES)
  review(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ): Promise<RemedialMaterialModel> {
    const dto = reviewRemedialSchema.parse(body);
    return this.service.review(user, id, dto);
  }
}
