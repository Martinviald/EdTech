import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.types';
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
  getMyOrg(@CurrentUser() user: JwtPayload) {
    return this.organizationsService.getProfile(user.orgId);
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

  /** PATCH /api/organizations/:id — actualizar perfil del colegio. */
  @Patch(':id')
  @Roles('school_admin', 'platform_admin')
  updateProfile(@Param('id') id: string, @Body() body: unknown, @CurrentUser() user: JwtPayload) {
    const dto = updateOrganizationProfileSchema.parse(body);
    return this.organizationsService.updateProfile(id, user.orgId, dto);
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
    return this.organizationsService.setupAcademicYear(id, user.orgId, dto);
  }
}
