import { Body, Controller, Get, Patch, Query, UseGuards } from '@nestjs/common';
import {
  REVIEW_SETTINGS_ROLES,
  updateOrgReviewSettingsSchema,
  type OrgReviewSettingsResponse,
} from '@soe/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { getEffectiveOrgId } from '../common/helpers/org-context.helper';
import { parseDtoOrBadRequest } from './parse-dto.helper';
import { ReviewSettingsService } from './review-settings.service';

@Controller('organizations/me/review-settings')
@UseGuards(RolesGuard)
export class ReviewSettingsController {
  constructor(private readonly reviewSettingsService: ReviewSettingsService) {}

  @Get()
  @Roles(...REVIEW_SETTINGS_ROLES)
  getSettings(
    @CurrentUser() user: JwtPayload,
    @Query('orgId') orgId?: string,
  ): Promise<OrgReviewSettingsResponse> {
    return this.reviewSettingsService.getSettings(getEffectiveOrgId(user, orgId));
  }

  @Patch()
  @Roles(...REVIEW_SETTINGS_ROLES)
  updateSettings(
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
    @Query('orgId') orgId?: string,
  ): Promise<OrgReviewSettingsResponse> {
    const dto = parseDtoOrBadRequest(updateOrgReviewSettingsSchema, body);
    return this.reviewSettingsService.updateSettings(getEffectiveOrgId(user, orgId), dto);
  }
}
