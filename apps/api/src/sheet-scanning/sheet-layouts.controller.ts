import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import {
  SHEET_MANAGEMENT_ROLES,
  deriveLayoutSchema,
  freezeLayoutSchema,
  sheetLayoutQuerySchema,
  type FreezeLayoutResponse,
  type LayoutDraftModel,
  type PaginatedResponse,
  type SheetLayoutModel,
  type SheetLayoutSummaryModel,
} from '@soe/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { getEffectiveOrgId } from '../common/helpers/org-context.helper';
import { parseDtoOrBadRequest } from './parse-dto.helper';
import { SheetLayoutService } from './sheet-layout.service';

@Controller('sheet-layouts')
@UseGuards(RolesGuard)
export class SheetLayoutsController {
  constructor(private readonly sheetLayoutService: SheetLayoutService) {}

  @Post('derive')
  @Roles(...SHEET_MANAGEMENT_ROLES)
  derive(
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
    @Query('orgId') orgId?: string,
  ): Promise<LayoutDraftModel> {
    const dto = parseDtoOrBadRequest(deriveLayoutSchema, body);
    return this.sheetLayoutService.deriveDraft(
      getEffectiveOrgId(user, orgId),
      dto.instrumentId,
      dto.identityMode ?? 'qr',
    );
  }

  @Post()
  @Roles(...SHEET_MANAGEMENT_ROLES)
  freeze(
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
    @Query('orgId') orgId?: string,
  ): Promise<FreezeLayoutResponse> {
    const dto = parseDtoOrBadRequest(freezeLayoutSchema, body);
    return this.sheetLayoutService.freeze(getEffectiveOrgId(user, orgId), user.userId, dto.spec);
  }

  @Get()
  @Roles(...SHEET_MANAGEMENT_ROLES)
  list(
    @Query() query: unknown,
    @CurrentUser() user: JwtPayload,
    @Query('orgId') orgId?: string,
  ): Promise<PaginatedResponse<SheetLayoutSummaryModel>> {
    const dto = parseDtoOrBadRequest(sheetLayoutQuerySchema, query);
    return this.sheetLayoutService.list(getEffectiveOrgId(user, orgId), dto);
  }

  @Get(':id')
  @Roles(...SHEET_MANAGEMENT_ROLES)
  getOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Query('orgId') orgId?: string,
  ): Promise<SheetLayoutModel> {
    return this.sheetLayoutService.getFrozen(getEffectiveOrgId(user, orgId), id);
  }
}
