import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  MASTER_BOARD_VIEWER_ROLES,
  TEACHER_PERFORMANCE_VIEWER_ROLES,
  masterBoardMatrixQuerySchema,
  masterBoardTakesQuerySchema,
  teacherPerformanceQuerySchema,
} from '@soe/types';
import { z } from 'zod';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { MasterBoardService } from './master-board.service';

const teacherIdSchema = z.string().uuid();

@Controller('master-board')
@UseGuards(RolesGuard)
export class MasterBoardController {
  constructor(private readonly service: MasterBoardService) {}

  @Get('takes')
  @Roles(...MASTER_BOARD_VIEWER_ROLES)
  getTakes(@Query() query: unknown, @CurrentUser() user: JwtPayload) {
    return this.service.getTakes(user, masterBoardTakesQuerySchema.parse(query ?? {}));
  }

  @Get('matrix')
  @Roles(...MASTER_BOARD_VIEWER_ROLES)
  getMatrix(@Query() query: unknown, @CurrentUser() user: JwtPayload) {
    return this.service.getMatrix(user, masterBoardMatrixQuerySchema.parse(query ?? {}));
  }

  @Get('teachers/:userId/performance')
  @Roles(...TEACHER_PERFORMANCE_VIEWER_ROLES)
  getTeacherPerformance(
    @Param('userId') userId: string,
    @Query() query: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.getTeacherPerformance(
      user,
      teacherIdSchema.parse(userId),
      teacherPerformanceQuerySchema.parse(query ?? {}),
    );
  }
}
