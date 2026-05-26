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
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { InstrumentsService } from './instruments.service';
import {
  createInstrumentSchema,
  updateInstrumentSchema,
  listInstrumentsQuerySchema,
  createSectionSchema,
  updateSectionSchema,
} from './dto/instrument.dto';

// Role sets — aligned with access-policies.ts concept
const INSTRUMENT_VIEWER_ROLES = [
  'school_admin',
  'academic_director',
  'cycle_director',
  'dept_head',
  'coordinator',
  'eval_coordinator',
  'homeroom_teacher',
  'teacher',
] as const;

const INSTRUMENT_EDITOR_ROLES = [
  'school_admin',
  'academic_director',
  'eval_coordinator',
] as const;

@Controller('instruments')
@UseGuards(RolesGuard)
export class InstrumentsController {
  constructor(private readonly instrumentsService: InstrumentsService) {}

  // ── Instruments ─────────────────────────────────────────────────────────

  /** GET /api/instruments — paginated list with filters. */
  @Get()
  @Roles(...INSTRUMENT_VIEWER_ROLES)
  list(@Query() query: unknown, @CurrentUser() user: JwtPayload) {
    const filters = listInstrumentsQuerySchema.parse(query);
    return this.instrumentsService.list(user, filters);
  }

  /** GET /api/instruments/:id — single instrument with sections populated. */
  @Get(':id')
  @Roles(...INSTRUMENT_VIEWER_ROLES)
  getOne(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.instrumentsService.getById(id, user);
  }

  /** POST /api/instruments — create instrument (optionally with sections inline). */
  @Post()
  @Roles(...INSTRUMENT_EDITOR_ROLES)
  create(@Body() body: unknown, @CurrentUser() user: JwtPayload) {
    const dto = createInstrumentSchema.parse(body);
    return this.instrumentsService.create(dto, user);
  }

  /** PATCH /api/instruments/:id — update instrument fields. */
  @Patch(':id')
  @Roles(...INSTRUMENT_EDITOR_ROLES)
  update(@Param('id') id: string, @Body() body: unknown, @CurrentUser() user: JwtPayload) {
    const dto = updateInstrumentSchema.parse(body);
    return this.instrumentsService.update(id, dto, user);
  }

  /** DELETE /api/instruments/:id — soft delete. */
  @Delete(':id')
  @Roles(...INSTRUMENT_EDITOR_ROLES)
  @HttpCode(204)
  async remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    await this.instrumentsService.softDelete(id, user);
  }

  // ── Sections ────────────────────────────────────────────────────────────

  /** GET /api/instruments/:id/sections — list sections. */
  @Get(':id/sections')
  @Roles(...INSTRUMENT_VIEWER_ROLES)
  listSections(@Param('id') instrumentId: string, @CurrentUser() user: JwtPayload) {
    return this.instrumentsService.listSections(instrumentId, user);
  }

  /** POST /api/instruments/:id/sections — create section. */
  @Post(':id/sections')
  @Roles(...INSTRUMENT_EDITOR_ROLES)
  createSection(
    @Param('id') instrumentId: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    const dto = createSectionSchema.parse(body);
    return this.instrumentsService.createSection(instrumentId, dto, user);
  }

  /** PATCH /api/instruments/:instrumentId/sections/:sectionId — update section. */
  @Patch(':instrumentId/sections/:sectionId')
  @Roles(...INSTRUMENT_EDITOR_ROLES)
  updateSection(
    @Param('instrumentId') instrumentId: string,
    @Param('sectionId') sectionId: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    const dto = updateSectionSchema.parse(body);
    return this.instrumentsService.updateSection(instrumentId, sectionId, dto, user);
  }

  /** DELETE /api/instruments/:instrumentId/sections/:sectionId — hard delete (cascade). */
  @Delete(':instrumentId/sections/:sectionId')
  @Roles(...INSTRUMENT_EDITOR_ROLES)
  @HttpCode(204)
  async removeSection(
    @Param('instrumentId') instrumentId: string,
    @Param('sectionId') sectionId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.instrumentsService.deleteSection(instrumentId, sectionId, user);
  }
}
