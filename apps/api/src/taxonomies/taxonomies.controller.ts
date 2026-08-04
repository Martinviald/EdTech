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
  createTaxonomySchema,
  listTaxonomiesQuerySchema,
  updateTaxonomySchema,
} from '@soe/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { TaxonomiesService } from './taxonomies.service';
import { buildTree } from './lib/tree-builder';

@Controller('taxonomies')
@UseGuards(RolesGuard)
export class TaxonomiesController {
  constructor(private readonly taxonomiesService: TaxonomiesService) {}

  /** GET /api/taxonomies — lista currícula visibles (oficiales + custom de la org). */
  @Get()
  @Roles('platform_admin', 'school_admin', 'academic_director')
  list(@Query() query: unknown, @CurrentUser() user: JwtPayload) {
    const filters = listTaxonomiesQuerySchema.parse(query);
    return this.taxonomiesService.listVisible(user, filters);
  }

  /** POST /api/taxonomies — crea un currículum. */
  @Post()
  @Roles('platform_admin', 'school_admin')
  create(@Body() body: unknown, @CurrentUser() user: JwtPayload) {
    const dto = createTaxonomySchema.parse(body);
    return this.taxonomiesService.create(dto, user);
  }

  /** GET /api/taxonomies/:id — detalle del currículum. */
  @Get(':id')
  @Roles('platform_admin', 'school_admin', 'academic_director')
  getOne(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.taxonomiesService.getById(id, user);
  }

  /** GET /api/taxonomies/:id/tree — árbol completo (taxonomy + nodos planos + estructura). */
  @Get(':id/tree')
  @Roles('platform_admin', 'school_admin', 'academic_director')
  async getTree(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    const { taxonomy, nodes } = await this.taxonomiesService.getTree(id, user);
    return { taxonomy, nodes, tree: buildTree(nodes) };
  }

  /** PATCH /api/taxonomies/:id — actualiza un currículum custom. */
  @Patch(':id')
  @Roles('platform_admin', 'school_admin')
  update(@Param('id') id: string, @Body() body: unknown, @CurrentUser() user: JwtPayload) {
    const dto = updateTaxonomySchema.parse(body);
    return this.taxonomiesService.update(id, dto, user);
  }

  /** DELETE /api/taxonomies/:id — elimina un currículum custom (cascade a nodos). */
  @Delete(':id')
  @Roles('platform_admin', 'school_admin')
  @HttpCode(204)
  async remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    await this.taxonomiesService.remove(id, user);
  }
}
