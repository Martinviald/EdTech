import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import {
  SHEET_MANAGEMENT_ROLES,
  createCaptureSessionSchema,
  type CaptureSessionStatusModel,
  type CreateCaptureSessionResponse,
  type FinishCaptureSessionResponse,
} from '@soe/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { getEffectiveOrgId } from '../common/helpers/org-context.helper';
import { CaptureSessionService } from './capture-session.service';
import { parseDtoOrBadRequest } from './parse-dto.helper';

@Controller('sheet-capture-sessions')
@UseGuards(RolesGuard)
export class SheetCaptureSessionsController {
  constructor(private readonly captureSessionService: CaptureSessionService) {}

  @Post()
  @Roles(...SHEET_MANAGEMENT_ROLES)
  create(
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
    @Query('orgId') orgId?: string,
  ): Promise<CreateCaptureSessionResponse> {
    const dto = parseDtoOrBadRequest(createCaptureSessionSchema, body);
    return this.captureSessionService.create(getEffectiveOrgId(user, orgId), user.userId, dto);
  }

  @Get(':id')
  @Roles(...SHEET_MANAGEMENT_ROLES)
  getOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Query('orgId') orgId?: string,
  ): Promise<CaptureSessionStatusModel> {
    return this.captureSessionService.getStatus(getEffectiveOrgId(user, orgId), id);
  }

  @Post(':id/revoke')
  @Roles(...SHEET_MANAGEMENT_ROLES)
  revoke(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Query('orgId') orgId?: string,
  ): Promise<CaptureSessionStatusModel> {
    return this.captureSessionService.revoke(getEffectiveOrgId(user, orgId), id);
  }

  @Post(':id/finish')
  @Roles(...SHEET_MANAGEMENT_ROLES)
  finish(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Query('orgId') orgId?: string,
  ): Promise<FinishCaptureSessionResponse> {
    return this.captureSessionService.finish(getEffectiveOrgId(user, orgId), id, user.userId);
  }
}
