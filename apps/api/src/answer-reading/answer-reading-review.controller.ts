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
  reviewQueueQuerySchema,
  reviewQueueScopeSchema,
  submitReviewSchema,
  undoReviewsSchema,
  type ReviewDecisionDetail,
  type ReviewQueuePage,
  type ReviewQueueSummary,
  type SubmitReviewResult,
} from '@soe/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { parseDtoOrBadRequest } from '../common/helpers/parse-dto.helper';
import { AnswerReadingReviewQueueService } from './answer-reading-review-queue.service';
import { AnswerReadingReviewsService } from './answer-reading-reviews.service';

@Controller('answer-reading')
@UseGuards(RolesGuard)
export class AnswerReadingReviewController {
  constructor(
    private readonly queueService: AnswerReadingReviewQueueService,
    private readonly reviewsService: AnswerReadingReviewsService,
  ) {}

  @Get('queue/summary')
  @Roles(...SHEET_REVIEW_ROLES)
  summary(@Query() query: unknown, @CurrentUser() user: JwtPayload): Promise<ReviewQueueSummary> {
    const scope = parseDtoOrBadRequest(reviewQueueScopeSchema, query);
    return this.queueService.summary(this.activeOrgId(user), scope);
  }

  @Get('queue')
  @Roles(...SHEET_REVIEW_ROLES)
  queue(@Query() query: unknown, @CurrentUser() user: JwtPayload): Promise<ReviewQueuePage> {
    const dto = parseDtoOrBadRequest(reviewQueueQuerySchema, query);
    return this.queueService.queue(this.activeOrgId(user), dto);
  }

  @Get('decisions/:id')
  @Roles(...SHEET_REVIEW_ROLES)
  detail(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<ReviewDecisionDetail> {
    return this.queueService.detail(this.activeOrgId(user), id);
  }

  @Post('reviews')
  @Roles(...SHEET_REVIEW_ROLES)
  submit(@Body() body: unknown, @CurrentUser() user: JwtPayload): Promise<SubmitReviewResult> {
    const dto = parseDtoOrBadRequest(submitReviewSchema, body);
    return this.reviewsService.submit(this.activeOrgId(user), user.userId, dto);
  }

  @Post('reviews/undo')
  @Roles(...SHEET_REVIEW_ROLES)
  undo(@Body() body: unknown, @CurrentUser() user: JwtPayload): Promise<SubmitReviewResult> {
    const dto = parseDtoOrBadRequest(undoReviewsSchema, body);
    return this.reviewsService.undo(this.activeOrgId(user), user.userId, dto);
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
