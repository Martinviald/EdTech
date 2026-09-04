import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import {
  captureAssessSchema,
  captureConfirmFileSchema,
  captureUploadIntentSchema,
  redeemCaptureSessionSchema,
  type AssessCaptureResponse,
  type CaptureSessionStatusModel,
  type FinishCaptureSessionResponse,
  type RedeemCaptureSessionResponse,
  type ScanUploadIntent,
} from '@soe/types';
import { Public } from '../common/decorators/public.decorator';
import { CaptureSessionGuard, CurrentCaptureSession } from './capture-session.guard';
import { CaptureSessionService } from './capture-session.service';
import type { ActiveCaptureSession } from './capture-token.helpers';
import { parseDtoOrBadRequest } from './parse-dto.helper';

@Controller('sheet-capture')
@Public()
export class SheetCaptureController {
  constructor(private readonly captureSessionService: CaptureSessionService) {}

  @Post('redeem')
  redeem(@Body() body: unknown): Promise<RedeemCaptureSessionResponse> {
    const dto = parseDtoOrBadRequest(redeemCaptureSessionSchema, body);
    return this.captureSessionService.redeem(dto);
  }

  @Get('session')
  @UseGuards(CaptureSessionGuard)
  getSession(
    @CurrentCaptureSession() session: ActiveCaptureSession,
  ): Promise<CaptureSessionStatusModel> {
    return this.captureSessionService.getStatus(session.orgId, session.sessionId);
  }

  @Post('assess')
  @UseGuards(CaptureSessionGuard)
  assess(
    @CurrentCaptureSession() session: ActiveCaptureSession,
    @Body() body: unknown,
  ): Promise<AssessCaptureResponse> {
    const dto = parseDtoOrBadRequest(captureAssessSchema, body);
    return this.captureSessionService.assess(session, dto);
  }

  @Post('upload-intent')
  @UseGuards(CaptureSessionGuard)
  createUploadIntent(
    @CurrentCaptureSession() session: ActiveCaptureSession,
    @Body() body: unknown,
  ): Promise<ScanUploadIntent> {
    const dto = parseDtoOrBadRequest(captureUploadIntentSchema, body);
    return this.captureSessionService.createUploadIntent(session, dto);
  }

  @Post('files/:id/confirm')
  @UseGuards(CaptureSessionGuard)
  async confirmFile(
    @CurrentCaptureSession() session: ActiveCaptureSession,
    @Param('id', ParseUUIDPipe) fileId: string,
    @Body() body: unknown,
  ): Promise<void> {
    const dto = parseDtoOrBadRequest(captureConfirmFileSchema, body);
    await this.captureSessionService.confirmFile(session, fileId, dto);
  }

  @Post('finish')
  @UseGuards(CaptureSessionGuard)
  finish(
    @CurrentCaptureSession() session: ActiveCaptureSession,
  ): Promise<FinishCaptureSessionResponse> {
    return this.captureSessionService.finish(session.orgId, session.sessionId, null);
  }
}
