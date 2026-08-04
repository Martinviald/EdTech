import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ANSWER_SHEET_IMPORT_ROLES,
  GRADING_SCALE_ROLES,
  gradingScaleCreateSchema,
  gradingScaleListQuerySchema,
  gradingScalePreviewRequestSchema,
  gradingScaleUpdateSchema,
} from '@soe/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { GradingScalesService } from './grading-scales.service';

/**
 * H5.7 — CRUD de escalas de notas y endpoint de preview % → nota.
 * Las lecturas y el preview se abren a `ANSWER_SHEET_IMPORT_ROLES` (incluye
 * eval_coordinator); las escrituras quedan restringidas a
 * `GRADING_SCALE_ROLES` (admin/dirección académica).
 */
@Controller('grading-scales')
@UseGuards(RolesGuard)
export class GradingScalesController {
  constructor(private readonly gradingScalesService: GradingScalesService) {}

  @Get()
  @Roles(...ANSWER_SHEET_IMPORT_ROLES)
  list(@Query() query: unknown, @CurrentUser() user: JwtPayload) {
    const parsed = gradingScaleListQuerySchema.parse(query);
    return this.gradingScalesService.list(user, parsed);
  }

  @Get(':id')
  @Roles(...ANSWER_SHEET_IMPORT_ROLES)
  getOne(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.gradingScalesService.getById(user, id);
  }

  @Post()
  @Roles(...GRADING_SCALE_ROLES)
  create(@Body() body: unknown, @CurrentUser() user: JwtPayload) {
    const dto = gradingScaleCreateSchema.parse(body);
    return this.gradingScalesService.create(user, dto);
  }

  @Patch(':id')
  @Roles(...GRADING_SCALE_ROLES)
  update(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    const dto = gradingScaleUpdateSchema.parse(body);
    return this.gradingScalesService.update(user, id, dto);
  }

  @Delete(':id')
  @Roles(...GRADING_SCALE_ROLES)
  @HttpCode(204)
  async remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    await this.gradingScalesService.delete(user, id);
  }

  @Post(':id/preview')
  @Roles(...ANSWER_SHEET_IMPORT_ROLES)
  @HttpCode(200)
  preview(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    const { percentages } = gradingScalePreviewRequestSchema.parse(body);
    return this.gradingScalesService.previewConversion(user, id, percentages);
  }
}
