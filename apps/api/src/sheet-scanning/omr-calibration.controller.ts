import { Body, Controller, Get, Patch, Query, UseGuards } from '@nestjs/common';
import {
  OMR_CALIBRATION_ROLES,
  updateOmrCalibrationSchema,
  type OmrCalibrationResponse,
} from '@soe/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { getEffectiveOrgId } from '../common/helpers/org-context.helper';
import { parseDtoOrBadRequest } from './parse-dto.helper';
import { OmrCalibrationService } from './omr-calibration.service';

@Controller('organizations/me/omr-calibration')
@UseGuards(RolesGuard)
export class OmrCalibrationController {
  constructor(private readonly omrCalibrationService: OmrCalibrationService) {}

  @Get()
  @Roles(...OMR_CALIBRATION_ROLES)
  getCalibration(
    @CurrentUser() user: JwtPayload,
    @Query('orgId') orgId?: string,
  ): Promise<OmrCalibrationResponse> {
    return this.omrCalibrationService.getCalibration(getEffectiveOrgId(user, orgId));
  }

  @Patch()
  @Roles(...OMR_CALIBRATION_ROLES)
  updateCalibration(
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
    @Query('orgId') orgId?: string,
  ): Promise<OmrCalibrationResponse> {
    const dto = parseDtoOrBadRequest(updateOmrCalibrationSchema, body);
    return this.omrCalibrationService.updateCalibration(getEffectiveOrgId(user, orgId), dto);
  }
}
