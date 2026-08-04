import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  adminCreateOrganizationSchema,
  adminCreateUserSchema,
  grantMembershipSchema,
  grantPlatformAdminSchema,
  listOrganizationsQuerySchema,
  searchUsersQuerySchema,
} from '@soe/types';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { AdminService } from './admin.service';

@Controller('admin')
@UseGuards(RolesGuard)
@Roles('platform_admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  // ── Organizaciones ───────────────────────────────────────────────

  @Get('organizations')
  listOrganizations(@Query() query: unknown) {
    const dto = listOrganizationsQuerySchema.parse(query);
    return this.admin.listOrganizations(dto);
  }

  @Post('organizations')
  createOrganization(@Body() body: unknown, @CurrentUser() user: JwtPayload) {
    const dto = adminCreateOrganizationSchema.parse(body);
    return this.admin.createOrganization(dto, user.userId);
  }

  @Get('organizations/:id')
  getOrganization(@Param('id') id: string) {
    return this.admin.getOrganizationDetail(id);
  }

  // ── Memberships ──────────────────────────────────────────────────

  @Get('organizations/:id/memberships')
  listMemberships(@Param('id') orgId: string) {
    return this.admin.listMemberships(orgId);
  }

  @Post('organizations/:id/memberships')
  grantMembership(
    @Param('id') orgId: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    const dto = grantMembershipSchema.parse(body);
    return this.admin.grantMembership(orgId, dto, user.userId);
  }

  @Delete('organizations/:id/memberships/:userId/:role')
  revokeMembership(
    @Param('id') orgId: string,
    @Param('userId') userId: string,
    @Param('role') role: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.admin.revokeMembership(orgId, userId, role, user.userId);
  }

  // ── Users ────────────────────────────────────────────────────────

  @Get('users')
  searchUsers(@Query() query: unknown) {
    const { q } = searchUsersQuerySchema.parse(query);
    return this.admin.searchUsers(q);
  }

  @Post('users')
  createUser(@Body() body: unknown, @CurrentUser() user: JwtPayload) {
    const dto = adminCreateUserSchema.parse(body);
    return this.admin.createUser(dto, user.userId);
  }

  // ── Platform admins ──────────────────────────────────────────────

  @Get('platform-admins')
  listPlatformAdmins() {
    return this.admin.listPlatformAdmins();
  }

  @Post('platform-admins')
  grantPlatformAdmin(@Body() body: unknown, @CurrentUser() user: JwtPayload) {
    const dto = grantPlatformAdminSchema.parse(body);
    return this.admin.grantPlatformAdmin(dto, user.userId);
  }

  @Delete('platform-admins/:userId')
  revokePlatformAdmin(
    @Param('userId') userId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.admin.revokePlatformAdmin(userId, user.userId);
  }
}
