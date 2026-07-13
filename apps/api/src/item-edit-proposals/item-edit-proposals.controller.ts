import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  ITEM_BANK_ROLES,
  ITEM_VIEWER_ROLES,
  listItemEditProposalsQuerySchema,
  proposeItemEditSchema,
  reviewItemEditProposalSchema,
} from '@soe/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { ItemEditProposalsService } from './item-edit-proposals.service';

/**
 * API de propuestas de edición de ítems (TKT-19). §8.3: la IA propone, el humano
 * aprueba. PROPONER y APROBAR/RECHAZAR requieren rol de edición de ítems
 * (`ITEM_BANK_ROLES`); LISTAR/VER una propuesta lo pueden hacer los que ya pueden
 * ver el banco (`ITEM_VIEWER_ROLES`). La identidad (orgId/roles) sale del token.
 */
@Controller('item-edit-proposals')
@UseGuards(RolesGuard)
export class ItemEditProposalsController {
  constructor(private readonly service: ItemEditProposalsService) {}

  /** POST /api/item-edit-proposals — genera una propuesta (IA) en estado pending. */
  @Post()
  @Roles(...ITEM_BANK_ROLES)
  propose(@Body() body: unknown, @CurrentUser() user: JwtPayload) {
    const dto = proposeItemEditSchema.parse(body);
    // Origen 'human': la solicitó un editor desde la UI (aunque el borrador lo
    // redacta la IA). El asistente conversacional usa la tool con author='ai'.
    return this.service.propose(user, dto, 'human');
  }

  /** GET /api/item-edit-proposals?itemId=&status= — propuestas de un ítem. */
  @Get()
  @Roles(...ITEM_VIEWER_ROLES)
  async list(@Query() query: unknown, @CurrentUser() user: JwtPayload) {
    const dto = listItemEditProposalsQuerySchema.parse(query);
    const data = await this.service.listForItem(user, dto);
    return { data };
  }

  /** GET /api/item-edit-proposals/:id — una propuesta. */
  @Get(':id')
  @Roles(...ITEM_VIEWER_ROLES)
  get(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.service.get(user, id);
  }

  /** POST /api/item-edit-proposals/:id/review — aprobar (aplica) o rechazar. */
  @Post(':id/review')
  @Roles(...ITEM_BANK_ROLES)
  review(@Param('id') id: string, @Body() body: unknown, @CurrentUser() user: JwtPayload) {
    const dto = reviewItemEditProposalSchema.parse(body);
    return this.service.review(user, id, dto);
  }
}
