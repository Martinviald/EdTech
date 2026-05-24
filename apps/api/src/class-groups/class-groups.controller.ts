import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { getEffectiveOrgId } from '../common/helpers/org-context.helper';
import { ClassGroupsService } from './class-groups.service';

@Controller('organizations/:orgId/class-groups')
@UseGuards(RolesGuard)
export class ClassGroupsController {
  constructor(private readonly service: ClassGroupsService) {}

  /**
   * GET /api/organizations/:orgId/class-groups
   * Devuelve la lista de cursos × asignaturas. Para profesores se filtra
   * server-side por sus teacher_assignments; para roles administrativos
   * devuelve todos los class_groups de la org.
   */
  @Get()
  @Roles(
    'teacher',
    'homeroom_teacher',
    'eval_coordinator',
    'coordinator',
    'dept_head',
    'cycle_director',
    'academic_director',
    'school_admin',
    'platform_admin',
  )
  list(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const effectiveOrgId = getEffectiveOrgId(user, orgId);
    return this.service.listForUser(effectiveOrgId, user);
  }
}
