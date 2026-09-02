import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { FEEDBACK_SUBMIT_ROLES, FEEDBACK_TRIAGE_ROLES } from '@soe/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { FeedbackService } from './feedback.service';
import {
  adminUpdateFeedbackSchema,
  createFeedbackSchema,
  feedbackAdminQuerySchema,
  feedbackQuerySchema,
  feedbackScreenshotUrlSchema,
  updateFeedbackSchema,
} from './dto/feedback.dto';

/**
 * Widget de comentarios in-app. Enviar está abierto a toda persona autenticada
 * de la org (quien más tropieza con la fricción es quien menos permisos tiene);
 * leer y hacer triage queda en dirección.
 */
@Controller('feedback')
@UseGuards(RolesGuard)
export class FeedbackController {
  constructor(private readonly feedbackService: FeedbackService) {}

  /** POST /api/feedback — envía un comentario. */
  @Post()
  @Roles(...FEEDBACK_SUBMIT_ROLES)
  async create(@Body() body: unknown, @CurrentUser() user: JwtPayload) {
    const dto = createFeedbackSchema.parse(body);
    return this.feedbackService.create(user, dto);
  }

  /** POST /api/feedback/screenshot-url — presigned para la captura opcional. */
  @Post('screenshot-url')
  @Roles(...FEEDBACK_SUBMIT_ROLES)
  async screenshotUrl(@Body() body: unknown, @CurrentUser() user: JwtPayload) {
    const dto = feedbackScreenshotUrlSchema.parse(body);
    return this.feedbackService.createScreenshotUploadUrl(user, dto);
  }

  /** POST /api/feedback/screenshot/:fileId/confirm — la captura ya está en S3. */
  @Post('screenshot/:fileId/confirm')
  @Roles(...FEEDBACK_SUBMIT_ROLES)
  async confirmScreenshot(@Param('fileId') fileId: string, @CurrentUser() user: JwtPayload) {
    return this.feedbackService.confirmScreenshot(user, fileId);
  }

  /** GET /api/feedback — bandeja de triage del colegio. */
  @Get()
  @Roles(...FEEDBACK_TRIAGE_ROLES)
  async list(@Query() query: unknown, @CurrentUser() user: JwtPayload) {
    const dto = feedbackQuerySchema.parse(query);
    return this.feedbackService.list(user, dto);
  }

  /**
   * GET /api/feedback/admin — bandeja cross-org del panel de plataforma.
   *
   * Va ANTES de las rutas con parámetro para que "admin" no se lea como un id.
   */
  @Get('admin')
  @Roles('platform_admin')
  async listAllOrgs(@Query() query: unknown) {
    const dto = feedbackAdminQuerySchema.parse(query);
    return this.feedbackService.listAllOrgs(dto);
  }

  /** PATCH /api/feedback/admin/:id — triage desde el panel de plataforma. */
  @Patch('admin/:id')
  @Roles('platform_admin')
  async updateAsPlatformAdmin(@Param('id') id: string, @Body() body: unknown) {
    const dto = adminUpdateFeedbackSchema.parse(body);
    return this.feedbackService.updateAsPlatformAdmin(id, dto);
  }

  /** PATCH /api/feedback/:id — estado y nota interna del triage. */
  @Patch(':id')
  @Roles(...FEEDBACK_TRIAGE_ROLES)
  async update(@Param('id') id: string, @Body() body: unknown, @CurrentUser() user: JwtPayload) {
    const dto = updateFeedbackSchema.parse(body);
    return this.feedbackService.update(user, id, dto);
  }
}
