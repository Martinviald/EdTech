import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  createTeacherAssignmentSchema,
  listTeacherAssignmentsQuerySchema,
} from '@soe/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { getEffectiveOrgId } from '../common/helpers/org-context.helper';
import { TeacherAssignmentsService } from './teacher-assignments.service';

@Controller('organizations/:orgId/teacher-assignments')
@UseGuards(RolesGuard)
export class TeacherAssignmentsController {
  constructor(private readonly service: TeacherAssignmentsService) {}

  /** GET /api/organizations/:orgId/teacher-assignments — lista asignaciones de la org. */
  @Get()
  @Roles('school_admin', 'academic_director', 'platform_admin')
  list(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query() query: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    const filters = listTeacherAssignmentsQuerySchema.parse(query);
    const effectiveOrgId = getEffectiveOrgId(user, orgId);
    return this.service.list(effectiveOrgId, filters);
  }

  /** POST /api/organizations/:orgId/teacher-assignments — asigna profesor a subject_class. */
  @Post()
  @Roles('school_admin', 'academic_director', 'platform_admin')
  create(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    const dto = createTeacherAssignmentSchema.parse(body);
    const effectiveOrgId = getEffectiveOrgId(user, orgId);
    return this.service.create(effectiveOrgId, dto);
  }

  /** DELETE /api/organizations/:orgId/teacher-assignments/:assignmentId — desasigna. */
  @Delete(':assignmentId')
  @Roles('school_admin', 'academic_director', 'platform_admin')
  @HttpCode(204)
  async remove(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const effectiveOrgId = getEffectiveOrgId(user, orgId);
    await this.service.remove(effectiveOrgId, assignmentId);
  }
}
