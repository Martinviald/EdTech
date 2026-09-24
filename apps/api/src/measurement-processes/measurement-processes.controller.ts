import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  PROCESS_MANAGEMENT_ROLES,
  PROCESS_VIEWER_ROLES,
  createMeasurementProcessSchema,
  linkProcessAssessmentsSchema,
  measurementProcessListQuerySchema,
  updateMeasurementProcessSchema,
  type MeasurementProcessListResponse,
  type MeasurementProcessModel,
  type ProcessCandidatesResponse,
  type ProcessCoverageResponse,
} from '@soe/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { MeasurementProcessesService } from './measurement-processes.service';

@Controller('measurement-processes')
@UseGuards(RolesGuard)
export class MeasurementProcessesController {
  constructor(private readonly service: MeasurementProcessesService) {}

  @Get()
  @Roles(...PROCESS_VIEWER_ROLES)
  list(
    @Query() query: unknown,
    @CurrentUser() user: JwtPayload,
  ): Promise<MeasurementProcessListResponse> {
    return this.service.list(user, measurementProcessListQuerySchema.parse(query ?? {}));
  }

  @Post()
  @Roles(...PROCESS_MANAGEMENT_ROLES)
  create(@Body() body: unknown, @CurrentUser() user: JwtPayload): Promise<MeasurementProcessModel> {
    return this.service.create(user, createMeasurementProcessSchema.parse(body));
  }

  @Get(':processId')
  @Roles(...PROCESS_VIEWER_ROLES)
  detail(
    @Param('processId', ParseUUIDPipe) processId: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<MeasurementProcessModel> {
    return this.service.detail(user, processId);
  }

  @Patch(':processId')
  @Roles(...PROCESS_MANAGEMENT_ROLES)
  update(
    @Param('processId', ParseUUIDPipe) processId: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ): Promise<MeasurementProcessModel> {
    return this.service.update(user, processId, updateMeasurementProcessSchema.parse(body));
  }

  @Delete(':processId')
  @Roles(...PROCESS_MANAGEMENT_ROLES)
  remove(
    @Param('processId', ParseUUIDPipe) processId: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<{ id: string; unlinked: number }> {
    return this.service.remove(user, processId);
  }

  @Get(':processId/coverage')
  @Roles(...PROCESS_VIEWER_ROLES)
  coverage(
    @Param('processId', ParseUUIDPipe) processId: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<ProcessCoverageResponse> {
    return this.service.coverage(user, processId);
  }

  @Get(':processId/candidates')
  @Roles(...PROCESS_MANAGEMENT_ROLES)
  candidates(
    @Param('processId', ParseUUIDPipe) processId: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<ProcessCandidatesResponse> {
    return this.service.candidates(user, processId);
  }

  @Post(':processId/assessments')
  @Roles(...PROCESS_MANAGEMENT_ROLES)
  linkAssessments(
    @Param('processId', ParseUUIDPipe) processId: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ): Promise<{ processId: string; linked: number; unlinked: number }> {
    return this.service.linkAssessments(user, processId, linkProcessAssessmentsSchema.parse(body));
  }
}
