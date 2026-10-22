import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  SHEET_REVIEW_ROLES,
  assignScanIdentitySchema,
  discardScanSchema,
  reviewMarkSchema,
  type BatchCorrectionsModel,
  type ConfirmBatchResponse,
  type ReviewMarkModel,
  type ReviewQueueModel,
  type ReviewScanModel,
} from '@soe/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { SensitiveDataGuard } from '../common/guards/sensitive-data.guard';
import { getEffectiveOrgId } from '../common/helpers/org-context.helper';
import { parseDtoOrBadRequest } from '../common/helpers/parse-dto.helper';
import { ScanReviewService } from './scan-review.service';

@Controller('sheet-scan-batches')
@UseGuards(RolesGuard)
export class ScanReviewBatchesController {
  constructor(private readonly scanReviewService: ScanReviewService) {}

  @Get(':id/review')
  @Roles(...SHEET_REVIEW_ROLES)
  @UseGuards(SensitiveDataGuard)
  getReviewQueue(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Query('orgId') orgId?: string,
  ): Promise<ReviewQueueModel> {
    return this.scanReviewService.getQueue(getEffectiveOrgId(user, orgId), id);
  }

  @Get(':id/corrections')
  @Roles(...SHEET_REVIEW_ROLES)
  @UseGuards(SensitiveDataGuard)
  getCorrections(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Query('orgId') orgId?: string,
  ): Promise<BatchCorrectionsModel> {
    return this.scanReviewService.getCorrections(getEffectiveOrgId(user, orgId), id);
  }

  @Post(':id/confirm')
  @Roles(...SHEET_REVIEW_ROLES)
  confirmBatch(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Query('orgId') orgId?: string,
  ): Promise<ConfirmBatchResponse> {
    return this.scanReviewService.confirmBatch(getEffectiveOrgId(user, orgId), user, id);
  }
}

@Controller('sheet-scan-marks')
@UseGuards(RolesGuard)
export class ScanReviewMarksController {
  constructor(private readonly scanReviewService: ScanReviewService) {}

  @Patch(':id')
  @UseGuards(SensitiveDataGuard)
  @Roles(...SHEET_REVIEW_ROLES)
  resolveMark(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
    @Query('orgId') orgId?: string,
  ): Promise<ReviewMarkModel> {
    const dto = parseDtoOrBadRequest(reviewMarkSchema, body);
    return this.scanReviewService.resolveMark(getEffectiveOrgId(user, orgId), user.userId, id, dto);
  }

  @Patch(':id/correction')
  @UseGuards(SensitiveDataGuard)
  @Roles(...SHEET_REVIEW_ROLES)
  correctConfirmedMark(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
    @Query('orgId') orgId?: string,
  ): Promise<ReviewMarkModel> {
    const dto = parseDtoOrBadRequest(reviewMarkSchema, body);
    return this.scanReviewService.correctConfirmedMark(
      getEffectiveOrgId(user, orgId),
      user.userId,
      id,
      dto,
    );
  }
}

@Controller('sheet-scans')
@UseGuards(RolesGuard)
export class ScanReviewScansController {
  constructor(private readonly scanReviewService: ScanReviewService) {}

  @Patch(':id/identity')
  @Roles(...SHEET_REVIEW_ROLES)
  @UseGuards(SensitiveDataGuard)
  assignIdentity(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
    @Query('orgId') orgId?: string,
  ): Promise<ReviewScanModel> {
    const dto = parseDtoOrBadRequest(assignScanIdentitySchema, body);
    return this.scanReviewService.assignIdentity(
      getEffectiveOrgId(user, orgId),
      user.userId,
      id,
      dto,
    );
  }

  @Patch(':id/discard')
  @UseGuards(SensitiveDataGuard)
  @Roles(...SHEET_REVIEW_ROLES)
  discardScan(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
    @Query('orgId') orgId?: string,
  ): Promise<ReviewScanModel> {
    const dto = parseDtoOrBadRequest(discardScanSchema, body);
    return this.scanReviewService.discardScan(getEffectiveOrgId(user, orgId), user.userId, id, dto);
  }
}
