import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { bulkInviteMembersSchema, inviteMemberSchema } from '@soe/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { StaffService } from './staff.service';

/**
 * Endpoint /organizations/me/members opera SIEMPRE sobre el orgId del JWT.
 * platform_admin que quiera gestionar memberships de otra org debe usar el
 * endpoint admin (/admin/organizations/:id/memberships).
 */
function requireOrgId(user: JwtPayload): string {
  if (!user.orgId) {
    throw new ForbiddenException('Sin organización activa');
  }
  return user.orgId;
}

const uuidSchema = z.string().uuid();

function parseUuid(value: string, label: string): string {
  const parsed = uuidSchema.safeParse(value);
  if (!parsed.success) {
    throw new BadRequestException(`${label} debe ser un UUID válido`);
  }
  return parsed.data;
}

@Controller('organizations/me/members')
@UseGuards(RolesGuard)
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  /** GET /api/organizations/me/members — lista miembros del colegio del usuario. */
  @Get()
  @Roles('school_admin', 'platform_admin')
  list(@CurrentUser() user: JwtPayload) {
    return this.staff.list(requireOrgId(user));
  }

  /** POST /api/organizations/me/members — invita un miembro. */
  @Post()
  @Roles('school_admin', 'platform_admin')
  invite(@Body() body: unknown, @CurrentUser() user: JwtPayload) {
    requireOrgId(user);
    const dto = inviteMemberSchema.parse(body);
    return this.staff.invite(user, dto);
  }

  /** POST /api/organizations/me/members/bulk — invita varios miembros (CSV pre-parseado). */
  @Post('bulk')
  @Roles('school_admin', 'platform_admin')
  bulkInvite(@Body() body: unknown, @CurrentUser() user: JwtPayload) {
    requireOrgId(user);
    const dto = bulkInviteMembersSchema.parse(body);
    return this.staff.bulkInvite(user, dto);
  }

  /** DELETE /api/organizations/me/members/:membershipId — revoca acceso (hard delete). */
  @Delete(':membershipId')
  @Roles('school_admin', 'platform_admin')
  @HttpCode(204)
  async revoke(
    @Param('membershipId') membershipId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    requireOrgId(user);
    const id = parseUuid(membershipId, 'membershipId');
    await this.staff.revoke(user, id);
  }
}
