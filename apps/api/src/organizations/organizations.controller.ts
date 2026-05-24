import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { getEffectiveOrgId } from '../common/helpers/org-context.helper';
import {
  updateOrganizationProfileSchema,
  academicSetupSchema,
} from '@soe/types';

@Controller('organizations')
@UseGuards(RolesGuard)
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  /** GET /api/organizations/me — perfil del colegio del usuario autenticado. */
  @Get('me')
  @Roles('school_admin', 'academic_director', 'cycle_director', 'teacher', 'platform_admin')
  getMyOrg(@CurrentUser() user: JwtPayload, @Query('orgId') orgId?: string) {
    return this.organizationsService.getProfile(getEffectiveOrgId(user, orgId));
  }

  /** GET /api/organizations/me/overview — perfil + estado del setup del año académico. */
  @Get('me/overview')
  @Roles('school_admin', 'academic_director', 'platform_admin')
  getOverview(@CurrentUser() user: JwtPayload, @Query('orgId') orgId?: string) {
    return this.organizationsService.getOverview(getEffectiveOrgId(user, orgId));
  }

  /** GET /api/organizations/grades — lista global de niveles educativos. */
  @Get('grades')
  @Roles('school_admin', 'academic_director', 'platform_admin')
  listGrades() {
    return this.organizationsService.listGrades();
  }

  /** GET /api/organizations/subjects — lista global de asignaturas. */
  @Get('subjects')
  @Roles('school_admin', 'academic_director', 'platform_admin')
  listSubjects() {
    return this.organizationsService.listSubjects();
  }

  /** GET /api/organizations/:orgId/teachers — usuarios elegibles como profesores. */
  @Get(':orgId/teachers')
  @Roles('school_admin', 'academic_director', 'platform_admin')
  listTeachers(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const effectiveOrgId = getEffectiveOrgId(user, orgId);
    return this.organizationsService.listTeachers(effectiveOrgId);
  }

  /** GET /api/organizations/:orgId/subject-classes — subject_classes del año vigente. */
  @Get(':orgId/subject-classes')
  @Roles('school_admin', 'academic_director', 'platform_admin')
  listSubjectClasses(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const effectiveOrgId = getEffectiveOrgId(user, orgId);
    return this.organizationsService.listSubjectClasses(effectiveOrgId);
  }

  /** PATCH /api/organizations/:id — actualizar perfil del colegio. */
  @Patch(':id')
  @Roles('school_admin', 'platform_admin')
  updateProfile(@Param('id') id: string, @Body() body: unknown, @CurrentUser() user: JwtPayload) {
    const dto = updateOrganizationProfileSchema.parse(body);
    const effectiveOrgId = getEffectiveOrgId(user, id);
    return this.organizationsService.updateProfile(id, effectiveOrgId, dto);
  }

  /** POST /api/organizations/:id/setup — configurar estructura académica del año. */
  @Post(':id/setup')
  @Roles('school_admin', 'platform_admin')
  setupAcademicYear(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    const dto = academicSetupSchema.parse(body);
    const effectiveOrgId = getEffectiveOrgId(user, id);
    return this.organizationsService.setupAcademicYear(id, effectiveOrgId, dto);
  }
}
