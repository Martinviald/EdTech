import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import {
  SHEET_MANAGEMENT_ROLES,
  createPrintRunSchema,
  printRunAssessmentOptionsQuerySchema,
  printRunQuerySchema,
  updatePrintRunSchema,
  type PaginatedResponse,
  type PrintRunAssessmentOption,
  type PrintRunModel,
} from '@soe/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { getEffectiveOrgId } from '../common/helpers/org-context.helper';
import { SheetPrintService } from './sheet-print.service';

@Controller('sheet-print-runs')
@UseGuards(RolesGuard)
export class SheetPrintRunsController {
  constructor(private readonly sheetPrintService: SheetPrintService) {}

  @Post()
  @Roles(...SHEET_MANAGEMENT_ROLES)
  create(
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
    @Query('orgId') orgId?: string,
  ): Promise<PrintRunModel> {
    const dto = createPrintRunSchema.parse(body);
    return this.sheetPrintService.createRun(getEffectiveOrgId(user, orgId), user.userId, dto);
  }

  @Get()
  @Roles(...SHEET_MANAGEMENT_ROLES)
  list(
    @Query() query: unknown,
    @CurrentUser() user: JwtPayload,
    @Query('orgId') orgId?: string,
  ): Promise<PaginatedResponse<PrintRunModel>> {
    const dto = printRunQuerySchema.parse(query);
    return this.sheetPrintService.list(getEffectiveOrgId(user, orgId), dto);
  }

  @Get('assessment-options')
  @Roles(...SHEET_MANAGEMENT_ROLES)
  assessmentOptions(
    @Query() query: unknown,
    @CurrentUser() user: JwtPayload,
    @Query('orgId') orgId?: string,
  ): Promise<PrintRunAssessmentOption[]> {
    const dto = printRunAssessmentOptionsQuerySchema.parse(query);
    return this.sheetPrintService.listAssessmentOptions(
      getEffectiveOrgId(user, orgId),
      dto.instrumentId,
    );
  }

  @Get(':id')
  @Roles(...SHEET_MANAGEMENT_ROLES)
  getOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Query('orgId') orgId?: string,
  ): Promise<PrintRunModel> {
    return this.sheetPrintService.getRun(getEffectiveOrgId(user, orgId), id);
  }

  @Patch(':id')
  @Roles(...SHEET_MANAGEMENT_ROLES)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
    @Query('orgId') orgId?: string,
  ): Promise<PrintRunModel> {
    const dto = updatePrintRunSchema.parse(body);
    return this.sheetPrintService.updateRun(getEffectiveOrgId(user, orgId), user.userId, id, dto);
  }

  @Get(':id/pdf')
  @Roles(...SHEET_MANAGEMENT_ROLES)
  async getPdf(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Query('orgId') orgId?: string,
  ): Promise<StreamableFile> {
    const pdf = await this.sheetPrintService.renderPdf(getEffectiveOrgId(user, orgId), id);
    return new StreamableFile(pdf, {
      type: 'application/pdf',
      disposition: `attachment; filename="hojas-${id}.pdf"`,
    });
  }
}
