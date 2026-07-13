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
  createTaxonomyNodeSchema,
  listTaxonomyNodeFacetsQuerySchema,
  listTaxonomyNodesQuerySchema,
  updateTaxonomyNodeSchema,
  ITEM_VIEWER_ROLES,
} from '@soe/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { NodesService } from './nodes.service';

@Controller('taxonomies/nodes')
@UseGuards(RolesGuard)
export class NodesController {
  constructor(private readonly nodesService: NodesService) {}

  /** GET /api/taxonomies/nodes — lista nodos con filtros. */
  @Get()
  @Roles('platform_admin', 'school_admin', 'academic_director')
  list(@Query() query: unknown, @CurrentUser() user: JwtPayload) {
    const filters = listTaxonomyNodesQuerySchema.parse(query);
    return this.nodesService.list(filters, user);
  }

  /** POST /api/taxonomies/nodes — crea un nodo (solo currícula editables). */
  @Post()
  @Roles('platform_admin', 'school_admin')
  create(@Body() body: unknown, @CurrentUser() user: JwtPayload) {
    const dto = createTaxonomyNodeSchema.parse(body);
    return this.nodesService.create(dto, user);
  }

  /**
   * GET /api/taxonomies/nodes/facets — opciones de nodos para los filtros del
   * banco de ítems, acotadas por asignatura/nivel/tipo (cross-currículo).
   * Accesible a quienes ven el banco (no solo admins). Debe ir antes de `:id`.
   */
  @Get('facets')
  @Roles(...ITEM_VIEWER_ROLES)
  listFacets(@Query() query: unknown, @CurrentUser() user: JwtPayload) {
    const filters = listTaxonomyNodeFacetsQuerySchema.parse(query);
    return this.nodesService.listFacets(filters, user);
  }

  /** GET /api/taxonomies/nodes/:id — detalle de un nodo. */
  @Get(':id')
  @Roles('platform_admin', 'school_admin', 'academic_director')
  getOne(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.nodesService.getById(id, user);
  }

  /** PATCH /api/taxonomies/nodes/:id — actualiza un nodo (solo currícula editables). */
  @Patch(':id')
  @Roles('platform_admin', 'school_admin')
  update(@Param('id') id: string, @Body() body: unknown, @CurrentUser() user: JwtPayload) {
    const dto = updateTaxonomyNodeSchema.parse(body);
    return this.nodesService.update(id, dto, user);
  }

  /** DELETE /api/taxonomies/nodes/:id?cascade=true — elimina un nodo (solo currícula editables). */
  @Delete(':id')
  @Roles('platform_admin', 'school_admin')
  @HttpCode(204)
  async remove(
    @Param('id') id: string,
    @Query('cascade') cascade: string | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.nodesService.remove(id, user, { cascade: cascade === 'true' });
  }
}
