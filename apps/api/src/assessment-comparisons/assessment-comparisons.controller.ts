import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  COMPARE_RESULTS_VIEWER_ROLES,
  assessmentComparisonCandidatesQuerySchema,
  assessmentComparisonQuerySchema,
  type AssessmentComparisonCandidatesResponse,
  type AssessmentComparisonResponse,
} from '@soe/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { parseDtoOrBadRequest } from '../common/helpers/parse-dto.helper';
import { AssessmentComparisonsService } from './assessment-comparisons.service';

@Controller('assessment-comparisons')
@UseGuards(RolesGuard)
export class AssessmentComparisonsController {
  constructor(private readonly service: AssessmentComparisonsService) {}

  @Get('candidates')
  @Roles(...COMPARE_RESULTS_VIEWER_ROLES)
  candidates(
    @Query() query: unknown,
    @CurrentUser() user: JwtPayload,
  ): Promise<AssessmentComparisonCandidatesResponse> {
    return this.service.listCandidates(
      user,
      parseDtoOrBadRequest(assessmentComparisonCandidatesQuerySchema, query ?? {}),
    );
  }

  @Get()
  @Roles(...COMPARE_RESULTS_VIEWER_ROLES)
  compare(
    @Query() query: unknown,
    @CurrentUser() user: JwtPayload,
  ): Promise<AssessmentComparisonResponse> {
    return this.service.compare(
      user,
      parseDtoOrBadRequest(assessmentComparisonQuerySchema, query ?? {}),
    );
  }
}
