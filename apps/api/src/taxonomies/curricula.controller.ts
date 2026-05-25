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
  createCurriculumSchema,
  listCurriculaQuerySchema,
  updateCurriculumSchema,
} from '@soe/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurriculaService } from './curricula.service';
import { buildTree } from './lib/tree-builder';

@Controller('taxonomies/curricula')
@UseGuards(RolesGuard)
export class CurriculaController {
  constructor(private readonly curriculaService: CurriculaService) {}

  /** GET /api/taxonomies/curricula — lista currícula visibles (oficiales + custom de la org). */
  @Get()
  @Roles('platform_admin', 'school_admin', 'academic_director')
  list(@Query() query: unknown, @CurrentUser() user: JwtPayload) {
    const filters = listCurriculaQuerySchema.parse(query);
    return this.curriculaService.listVisible(user, filters);
  }

  /** POST /api/taxonomies/curricula — crea un currículum. */
  @Post()
  @Roles('platform_admin', 'school_admin')
  create(@Body() body: unknown, @CurrentUser() user: JwtPayload) {
    const dto = createCurriculumSchema.parse(body);
    return this.curriculaService.create(dto, user);
  }

  /** GET /api/taxonomies/curricula/:id — detalle del currículum. */
  @Get(':id')
  @Roles('platform_admin', 'school_admin', 'academic_director')
  getOne(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.curriculaService.getById(id, user);
  }

  /** GET /api/taxonomies/curricula/:id/tree — árbol completo (curriculum + nodos planos + estructura). */
  @Get(':id/tree')
  @Roles('platform_admin', 'school_admin', 'academic_director')
  async getTree(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    const { curriculum, nodes } = await this.curriculaService.getTree(id, user);
    return { curriculum, nodes, tree: buildTree(nodes) };
  }

  /** PATCH /api/taxonomies/curricula/:id — actualiza un currículum custom. */
  @Patch(':id')
  @Roles('platform_admin', 'school_admin')
  update(@Param('id') id: string, @Body() body: unknown, @CurrentUser() user: JwtPayload) {
    const dto = updateCurriculumSchema.parse(body);
    return this.curriculaService.update(id, dto, user);
  }

  /** DELETE /api/taxonomies/curricula/:id — elimina un currículum custom (cascade a nodos). */
  @Delete(':id')
  @Roles('platform_admin', 'school_admin')
  @HttpCode(204)
  async remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    await this.curriculaService.remove(id, user);
  }
}
