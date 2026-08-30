import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import {
  SHEET_MANAGEMENT_ROLES,
  assessCaptureSchema,
  createScanBatchSchema,
  scanBatchQuerySchema,
  type AssessCaptureResponse,
  type BatchStatusModel,
  type CreateScanBatchResponse,
  type PaginatedResponse,
} from '@soe/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { getEffectiveOrgId } from '../common/helpers/org-context.helper';
import { SheetScanService } from './sheet-scan.service';

@Controller('sheet-scan-batches')
@UseGuards(RolesGuard)
export class SheetScanBatchesController {
  constructor(private readonly sheetScanService: SheetScanService) {}

  @Post()
  @Roles(...SHEET_MANAGEMENT_ROLES)
  create(
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
    @Query('orgId') orgId?: string,
  ): Promise<CreateScanBatchResponse> {
    const dto = createScanBatchSchema.parse(body);
    return this.sheetScanService.createBatch(getEffectiveOrgId(user, orgId), user.userId, dto);
  }

  @Post('assess-capture')
  @Roles(...SHEET_MANAGEMENT_ROLES)
  assessCapture(
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
    @Query('orgId') orgId?: string,
  ): Promise<AssessCaptureResponse> {
    const dto = assessCaptureSchema.parse(body);
    return this.sheetScanService.assessCapture(getEffectiveOrgId(user, orgId), dto);
  }

  @Post(':id/start')
  @Roles(...SHEET_MANAGEMENT_ROLES)
  start(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Query('orgId') orgId?: string,
  ): Promise<BatchStatusModel> {
    return this.sheetScanService.startProcessing(getEffectiveOrgId(user, orgId), user.userId, id);
  }

  @Post(':id/retry')
  @Roles(...SHEET_MANAGEMENT_ROLES)
  retry(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Query('orgId') orgId?: string,
  ): Promise<BatchStatusModel> {
    return this.sheetScanService.retry(getEffectiveOrgId(user, orgId), user.userId, id);
  }

  @Get()
  @Roles(...SHEET_MANAGEMENT_ROLES)
  list(
    @Query() query: unknown,
    @CurrentUser() user: JwtPayload,
    @Query('orgId') orgId?: string,
  ): Promise<PaginatedResponse<BatchStatusModel>> {
    const dto = scanBatchQuerySchema.parse(query);
    return this.sheetScanService.list(getEffectiveOrgId(user, orgId), dto);
  }

  @Get(':id')
  @Roles(...SHEET_MANAGEMENT_ROLES)
  getOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Query('orgId') orgId?: string,
  ): Promise<BatchStatusModel> {
    return this.sheetScanService.getBatch(getEffectiveOrgId(user, orgId), id);
  }
}
