import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  SHEET_REVIEW_ROLES,
  acceptRubricProposalsSchema,
  rubricApprovalSchema,
  rubricQueueQuerySchema,
  type RubricApprovalResult,
  type RubricQueuePage,
  type RubricReviewDetail,
} from '@soe/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { parseDtoOrBadRequest } from '../common/helpers/parse-dto.helper';
import { RubricReviewService } from './rubric-review.service';

@Controller('answer-reading')
@UseGuards(RolesGuard)
export class RubricReviewController {
  constructor(private readonly rubricReview: RubricReviewService) {}

  @Get('rubric-queue')
  @Roles(...SHEET_REVIEW_ROLES)
  queue(@Query() query: unknown, @CurrentUser() user: JwtPayload): Promise<RubricQueuePage> {
    const dto = parseDtoOrBadRequest(rubricQueueQuerySchema, query);
    return this.rubricReview.queue(this.activeOrgId(user), dto);
  }

  @Get('rubric-queue/:decisionId')
  @Roles(...SHEET_REVIEW_ROLES)
  detail(
    @Param('decisionId', new ParseUUIDPipe()) decisionId: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<RubricReviewDetail> {
    return this.rubricReview.detail(this.activeOrgId(user), decisionId);
  }

  @Post('rubric-approvals')
  @Roles(...SHEET_REVIEW_ROLES)
  approve(@Body() body: unknown, @CurrentUser() user: JwtPayload): Promise<RubricApprovalResult> {
    const dto = parseDtoOrBadRequest(rubricApprovalSchema, body);
    return this.rubricReview.approve(this.activeOrgId(user), user.userId, dto);
  }

  @Post('rubric-approvals/accept-proposals')
  @Roles(...SHEET_REVIEW_ROLES)
  acceptProposals(
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ): Promise<RubricApprovalResult> {
    const dto = parseDtoOrBadRequest(acceptRubricProposalsSchema, body);
    return this.rubricReview.acceptProposals(this.activeOrgId(user), user.userId, dto);
  }

  private activeOrgId(user: JwtPayload): string {
    if (!user.orgId) {
      throw new ForbiddenException(
        'Sin organización activa. Selecciona una organización antes de continuar.',
      );
    }
    return user.orgId;
  }
}
