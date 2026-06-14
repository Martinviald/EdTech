import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import {
  BENCHMARKING_ADMIN_ROLES,
  BENCHMARKING_VIEWER_ROLES,
  benchmarkAuditListQuerySchema,
  benchmarkComparisonQuerySchema,
} from '@soe/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { BenchmarkingRefreshService } from './benchmarking-refresh.service';
import { BenchmarkingService } from './benchmarking.service';

/**
 * F2 S4 — Benchmarking Institucional (H7.1–H7.4, H7.6). Opera SIEMPRE sobre la
 * org del token (`user.orgId`); el read-model cross-tenant `benchmark_aggregates`
 * se accede dentro del service con guards de rol + k-anonimato.
 */
@Controller('benchmarking')
@UseGuards(RolesGuard)
export class BenchmarkingController {
  constructor(
    private readonly service: BenchmarkingService,
    private readonly refreshService: BenchmarkingRefreshService,
  ) {}

  /** GET /api/benchmarking/instruments — instrumentos comparables de la org. */
  @Get('instruments')
  @Roles(...BENCHMARKING_VIEWER_ROLES)
  listInstruments(@CurrentUser() user: JwtPayload) {
    return this.service.listInstruments(user);
  }

  /** GET /api/benchmarking/comparison — comparación mismo-instrumento + access log. */
  @Get('comparison')
  @Roles(...BENCHMARKING_VIEWER_ROLES)
  compare(@CurrentUser() user: JwtPayload, @Query() query: unknown) {
    const dto = benchmarkComparisonQuerySchema.parse(query ?? {});
    return this.service.compare(user, dto);
  }

  /** GET /api/benchmarking/audit — accesos de la propia org (paginado). */
  @Get('audit')
  @Roles(...BENCHMARKING_VIEWER_ROLES)
  listAudit(@CurrentUser() user: JwtPayload, @Query() query: unknown) {
    const dto = benchmarkAuditListQuerySchema.parse(query ?? {});
    return this.service.listAudit(user, dto);
  }

  /** POST /api/benchmarking/refresh — reconstruye el read-model (operación global). */
  @Post('refresh')
  @Roles(...BENCHMARKING_ADMIN_ROLES)
  refresh() {
    return this.refreshService.refresh();
  }
}
