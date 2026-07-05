import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
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
  type RemedialStimulusRef,
} from '@soe/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { RequireFeature } from '../common/decorators/feature.decorator';
import { FeatureGuard } from '../common/guards/feature.guard';
import { JOB_DISPATCHER, type JobDispatcher } from '../jobs/job-dispatcher';
import { RemedialRunner } from './remedial.runner';
import { RemedialService } from './remedial.service';
import { BankPassageService } from './stimulus/bank-passage.service';
import {
  FailedStimulusService,
  type FailedStimulus,
} from './stimulus/failed-stimulus.service';

/**
 * Query del picker de estímulos (Ola 2.1a). Validación Zod local al módulo: es BE-only
 * (no compartida con `web`). Los schemas compartidos viven en `@soe/types`.
 */
const candidateStimuliQuerySchema = z.object({
  assessmentId: z.string().uuid(),
  nodeId: z.string().uuid(),
});

/**
 * API del módulo de IA Remedial (F2 S3 — H9.1–H9.5). Validación Zod en cada
 * handler; autorización por las constantes de roles de `@soe/types`. La
 * generación se encola vía el puerto `JOB_DISPATCHER` (async); el frontend hace
 * polling con `GET /:id`. `orgId` SIEMPRE del token (en el service).
 */
@Controller('remedial')
@UseGuards(RolesGuard, FeatureGuard)
@RequireFeature('remedial')
export class RemedialController {
  constructor(
    private readonly service: RemedialService,
    private readonly runner: RemedialRunner,
    private readonly failedStimulus: FailedStimulusService,
    private readonly bankPassages: BankPassageService,
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

  /**
   * GET /api/remedial/candidate-stimuli?assessmentId&nodeId
   *
   * Alimenta el picker de pasaje del modo A (Ola 2.1a): `fromAssessment` = pasajes
   * fallados de la evaluación (mayor brecha primero, default del picker); `fromBank` =
   * pasajes publicados del banco para el nodo (override / fallback). `orgId` SIEMPRE del
   * token. Declarado ANTES de `:id` para que la ruta estática no la capture el parámetro.
   */
  @Get('candidate-stimuli')
  @Roles(...REMEDIAL_GENERATOR_ROLES)
  async candidateStimuli(
    @Query() query: unknown,
    @CurrentUser() user: JwtPayload,
  ): Promise<{ fromAssessment: FailedStimulus[]; fromBank: RemedialStimulusRef[] }> {
    const { assessmentId, nodeId } = candidateStimuliQuerySchema.parse(query);
    if (!user.orgId) {
      throw new ForbiddenException(
        'Sin organización activa. Selecciona una organización antes de continuar.',
      );
    }
    const [fromAssessment, fromBank] = await Promise.all([
      this.failedStimulus.list(user.orgId, assessmentId, nodeId),
      this.bankPassages.listCandidates(user.orgId, nodeId, assessmentId),
    ]);
    return { fromAssessment, fromBank };
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
