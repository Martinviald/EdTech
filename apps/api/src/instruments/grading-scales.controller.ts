import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { InstrumentsService } from './instruments.service';
import {
  createGradingScaleSchema,
  updateGradingScaleSchema,
} from './dto/instrument.dto';

const GRADING_SCALE_VIEWER_ROLES = [
  'school_admin',
  'academic_director',
  'cycle_director',
  'dept_head',
  'coordinator',
  'eval_coordinator',
  'homeroom_teacher',
  'teacher',
] as const;

const GRADING_SCALE_EDITOR_ROLES = [
  'school_admin',
  'academic_director',
  'eval_coordinator',
] as const;

@Controller('grading-scales')
@UseGuards(RolesGuard)
export class GradingScalesController {
  constructor(private readonly instrumentsService: InstrumentsService) {}

  /** GET /api/grading-scales — list org's grading scales. */
  @Get()
  @Roles(...GRADING_SCALE_VIEWER_ROLES)
  list(@CurrentUser() user: JwtPayload) {
    return this.instrumentsService.listGradingScales(user);
  }

  /** POST /api/grading-scales — create scale. */
  @Post()
  @Roles(...GRADING_SCALE_EDITOR_ROLES)
  create(@Body() body: unknown, @CurrentUser() user: JwtPayload) {
    const dto = createGradingScaleSchema.parse(body);
    return this.instrumentsService.createGradingScale(dto, user);
  }

  /** PATCH /api/grading-scales/:id — update scale. */
  @Patch(':id')
  @Roles(...GRADING_SCALE_EDITOR_ROLES)
  update(@Param('id') id: string, @Body() body: unknown, @CurrentUser() user: JwtPayload) {
    const dto = updateGradingScaleSchema.parse(body);
    return this.instrumentsService.updateGradingScale(id, dto, user);
  }

  /** DELETE /api/grading-scales/:id — hard delete. */
  @Delete(':id')
  @Roles(...GRADING_SCALE_EDITOR_ROLES)
  @HttpCode(204)
  async remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    await this.instrumentsService.deleteGradingScale(id, user);
  }
}
