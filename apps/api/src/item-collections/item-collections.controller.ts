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
import { ITEM_BANK_ROLES, ITEM_VIEWER_ROLES } from '@soe/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { ItemCollectionsService } from './item-collections.service';
import {
  addCollectionItemsSchema,
  createItemCollectionSchema,
  itemCollectionListQuerySchema,
  materializeCollectionSchema,
  updateItemCollectionSchema,
} from './dto/item-collection.dto';

@Controller('item-collections')
@UseGuards(RolesGuard)
export class ItemCollectionsController {
  constructor(private readonly collectionsService: ItemCollectionsService) {}

  @Get()
  @Roles(...ITEM_VIEWER_ROLES)
  list(@Query() query: unknown, @CurrentUser() user: JwtPayload) {
    const filters = itemCollectionListQuerySchema.parse(query);
    return this.collectionsService.list(user, filters);
  }

  @Get(':id')
  @Roles(...ITEM_VIEWER_ROLES)
  getOne(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.collectionsService.getById(id, user);
  }

  @Post()
  @Roles(...ITEM_BANK_ROLES)
  create(@Body() body: unknown, @CurrentUser() user: JwtPayload) {
    const dto = createItemCollectionSchema.parse(body);
    return this.collectionsService.create(dto, user);
  }

  @Patch(':id')
  @Roles(...ITEM_BANK_ROLES)
  update(@Param('id') id: string, @Body() body: unknown, @CurrentUser() user: JwtPayload) {
    const dto = updateItemCollectionSchema.parse(body);
    return this.collectionsService.update(id, dto, user);
  }

  @Delete(':id')
  @Roles(...ITEM_BANK_ROLES)
  @HttpCode(204)
  async remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    await this.collectionsService.softDelete(id, user);
  }

  @Post(':id/items')
  @Roles(...ITEM_BANK_ROLES)
  addItems(@Param('id') id: string, @Body() body: unknown, @CurrentUser() user: JwtPayload) {
    const dto = addCollectionItemsSchema.parse(body);
    return this.collectionsService.addItems(id, dto, user);
  }

  @Delete(':id/items/:itemId')
  @Roles(...ITEM_BANK_ROLES)
  @HttpCode(204)
  async removeItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.collectionsService.removeItem(id, itemId, user);
  }

  @Post(':id/materialize')
  @Roles(...ITEM_BANK_ROLES)
  materialize(@Param('id') id: string, @Body() body: unknown, @CurrentUser() user: JwtPayload) {
    const dto = materializeCollectionSchema.parse(body);
    return this.collectionsService.materialize(id, dto, user);
  }
}
