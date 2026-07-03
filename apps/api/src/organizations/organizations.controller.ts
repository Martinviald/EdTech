import {
  Body,
  Controller,
  Delete,
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
  addSubjectToClassGroupSchema,
  bulkAddSubjectsSchema,
  createClassGroupSchema,
  updateOrganizationProfileSchema,
  academicSetupSchema,
  updateOrgFeaturesSchema,
  FEATURE_MANAGEMENT_ROLES,
  type OrgFeaturesResponse,
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

  /**
   * GET /api/organizations/me/features — features pagas habilitadas para la org
   * del usuario (H18.1). Accesible a cualquier usuario autenticado de la org: el
   * frontend lo usa para decidir el gating (CTA de upgrade) de las páginas pagas.
   */
  @Get('me/features')
  getMyFeatures(
    @CurrentUser() user: JwtPayload,
    @Query('orgId') orgId?: string,
  ): Promise<OrgFeaturesResponse> {
    return this.organizationsService.getFeatures(getEffectiveOrgId(user, orgId));
  }

  /** GET /api/organizations/:orgId/features — plan de features de una org (gestión). */
  @Get(':orgId/features')
  @Roles(...FEATURE_MANAGEMENT_ROLES)
  getFeatures(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<OrgFeaturesResponse> {
    return this.organizationsService.getFeatures(getEffectiveOrgId(user, orgId));
  }

  /** PATCH /api/organizations/:orgId/features — habilita/deshabilita features pagas + presupuesto IA. */
  @Patch(':orgId/features')
  @Roles(...FEATURE_MANAGEMENT_ROLES)
  updateFeatures(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ): Promise<OrgFeaturesResponse> {
    const dto = updateOrgFeaturesSchema.parse(body);
    return this.organizationsService.updateFeatures(getEffectiveOrgId(user, orgId), dto);
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

  /** DELETE /api/organizations/:id — soft-delete del colegio. Solo platform_admin. */
  @Delete(':id')
  @Roles('platform_admin')
  softDelete(@Param('id', ParseUUIDPipe) id: string) {
    return this.organizationsService.softDelete(id);
  }

  /** POST /api/organizations/:id/restore — restaura un colegio soft-deleted. Solo platform_admin. */
  @Post(':id/restore')
  @Roles('platform_admin')
  restore(@Param('id', ParseUUIDPipe) id: string) {
    return this.organizationsService.restore(id);
  }

  // ── Asignaturas (subject_classes) ───────────────────────────────────

  /** GET /api/organizations/:orgId/subject-matrix — cursos × asignaturas del año vigente. */
  @Get(':orgId/subject-matrix')
  @Roles('school_admin', 'academic_director', 'platform_admin')
  getSubjectMatrix(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const effectiveOrgId = getEffectiveOrgId(user, orgId);
    return this.organizationsService.getSubjectMatrix(effectiveOrgId);
  }

  /** POST /api/organizations/:orgId/subject-classes/bulk — agrega asignaturas a TODOS los cursos del año. */
  @Post(':orgId/subject-classes/bulk')
  @Roles('school_admin', 'academic_director', 'platform_admin')
  bulkAddSubjects(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    const dto = bulkAddSubjectsSchema.parse(body);
    const effectiveOrgId = getEffectiveOrgId(user, orgId);
    return this.organizationsService.bulkAddSubjects(effectiveOrgId, dto);
  }

  /** POST /api/organizations/:orgId/class-groups/:classGroupId/subjects — agrega una asignatura a UN curso. */
  @Post(':orgId/class-groups/:classGroupId/subjects')
  @Roles('school_admin', 'academic_director', 'platform_admin')
  addSubjectToClassGroup(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('classGroupId', ParseUUIDPipe) classGroupId: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    const dto = addSubjectToClassGroupSchema.parse(body);
    const effectiveOrgId = getEffectiveOrgId(user, orgId);
    return this.organizationsService.addSubjectToClassGroup(
      effectiveOrgId,
      classGroupId,
      dto.subjectId,
    );
  }

  /** DELETE /api/organizations/:orgId/subject-classes/:subjectClassId — quita una asignatura de un curso. */
  @Delete(':orgId/subject-classes/:subjectClassId')
  @Roles('school_admin', 'academic_director', 'platform_admin')
  removeSubjectClass(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('subjectClassId', ParseUUIDPipe) subjectClassId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const effectiveOrgId = getEffectiveOrgId(user, orgId);
    return this.organizationsService.removeSubjectClass(effectiveOrgId, subjectClassId);
  }

  // ── Class groups (Fase C) ───────────────────────────────────────────

  /** POST /api/organizations/:orgId/class-groups — crea un curso suelto en el año vigente. */
  @Post(':orgId/class-groups')
  @Roles('school_admin', 'academic_director', 'platform_admin')
  createClassGroup(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    const dto = createClassGroupSchema.parse(body);
    const effectiveOrgId = getEffectiveOrgId(user, orgId);
    return this.organizationsService.createClassGroup(effectiveOrgId, dto);
  }

  /** DELETE /api/organizations/:orgId/class-groups/:classGroupId — borra un curso (valida sin datos). */
  @Delete(':orgId/class-groups/:classGroupId')
  @Roles('school_admin', 'academic_director', 'platform_admin')
  deleteClassGroup(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('classGroupId', ParseUUIDPipe) classGroupId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const effectiveOrgId = getEffectiveOrgId(user, orgId);
    return this.organizationsService.deleteClassGroup(effectiveOrgId, classGroupId);
  }
}
