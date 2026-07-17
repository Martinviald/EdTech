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
import { ItemsService } from './items.service';
import {
  createItemSchema,
  updateItemSchema,
  listItemsQuerySchema,
  createTagSchema,
  batchTagSchema,
  createVersionSchema,
} from './dto/item.dto';

// Role sets — aligned with access-policies.ts ITEM_BANK_ROLES / ITEM_VIEWER_ROLES concept
const ITEM_VIEWER_ROLES = [
  'school_admin',
  'academic_director',
  'cycle_director',
  'dept_head',
  'coordinator',
  'eval_coordinator',
  'homeroom_teacher',
  'teacher',
] as const;

const ITEM_BANK_ROLES = ['school_admin', 'academic_director', 'eval_coordinator'] as const;

@Controller('items')
@UseGuards(RolesGuard)
export class ItemsController {
  constructor(private readonly itemsService: ItemsService) {}

  // ── Items ───────────────────────────────────────────────────────────────

  /** GET /api/items — paginated list with filters. */
  @Get()
  @Roles(...ITEM_VIEWER_ROLES)
  list(@Query() query: unknown, @CurrentUser() user: JwtPayload) {
    const filters = listItemsQuerySchema.parse(query);
    return this.itemsService.list(user, filters);
  }

  /** GET /api/items/:id — single item with tags populated. */
  @Get(':id')
  @Roles(...ITEM_VIEWER_ROLES)
  getOne(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.itemsService.getById(id, user);
  }

  /** GET /api/items/:id/figura — metadata + URLs prefirmadas de la figura (o null). */
  @Get(':id/figura')
  @Roles(...ITEM_VIEWER_ROLES)
  getFigure(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.itemsService.getFigure(id, user);
  }

  /**
   * GET /api/items/:id/alternativa/:key/figura — metadata + URLs prefirmadas de la figura
   * de una alternativa (ítems con opciones-imagen), o null.
   */
  @Get(':id/alternativa/:key/figura')
  @Roles(...ITEM_VIEWER_ROLES)
  getAltFigure(
    @Param('id') id: string,
    @Param('key') key: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.itemsService.getAltFigure(id, key, user);
  }

  /** POST /api/items — create item (optionally with tags inline). */
  @Post()
  @Roles(...ITEM_BANK_ROLES)
  create(@Body() body: unknown, @CurrentUser() user: JwtPayload) {
    const dto = createItemSchema.parse(body);
    return this.itemsService.create(dto, user);
  }

  /** PATCH /api/items/:id — update item (bumps version automatically). */
  @Patch(':id')
  @Roles(...ITEM_BANK_ROLES)
  update(@Param('id') id: string, @Body() body: unknown, @CurrentUser() user: JwtPayload) {
    const dto = updateItemSchema.parse(body);
    return this.itemsService.update(id, dto, user);
  }

  /** DELETE /api/items/:id — soft delete. */
  @Delete(':id')
  @Roles(...ITEM_BANK_ROLES)
  @HttpCode(204)
  async remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    await this.itemsService.softDelete(id, user);
  }

  // ── Tags ────────────────────────────────────────────────────────────────

  /** POST /api/items/:id/tags — add taxonomy tag to item. */
  @Post(':id/tags')
  @Roles(...ITEM_BANK_ROLES)
  addTag(@Param('id') itemId: string, @Body() body: unknown, @CurrentUser() user: JwtPayload) {
    const dto = createTagSchema.parse(body);
    return this.itemsService.addTag(itemId, dto, user);
  }

  /** DELETE /api/items/:id/tags/:tagId — remove tag. */
  @Delete(':id/tags/:tagId')
  @Roles(...ITEM_BANK_ROLES)
  @HttpCode(204)
  async removeTag(
    @Param('id') itemId: string,
    @Param('tagId') tagId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.itemsService.removeTag(itemId, tagId, user);
  }

  /** POST /api/items/batch-tag — bulk add tags to multiple items. */
  @Post('batch-tag')
  @Roles(...ITEM_BANK_ROLES)
  batchTag(@Body() body: unknown, @CurrentUser() user: JwtPayload) {
    const dto = batchTagSchema.parse(body);
    return this.itemsService.batchTag(dto, user);
  }

  // ── Versions ────────────────────────────────────────────────────────────

  /** GET /api/items/:id/versions — list version history. */
  @Get(':id/versions')
  @Roles(...ITEM_VIEWER_ROLES)
  listVersions(@Param('id') itemId: string, @CurrentUser() user: JwtPayload) {
    return this.itemsService.listVersions(itemId, user);
  }

  /** POST /api/items/:id/versions — create explicit version snapshot. */
  @Post(':id/versions')
  @Roles(...ITEM_BANK_ROLES)
  createVersion(
    @Param('id') itemId: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    const dto = createVersionSchema.parse(body);
    return this.itemsService.createVersion(itemId, dto, user);
  }
}
