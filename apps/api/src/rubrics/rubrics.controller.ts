import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ITEM_VIEWER_ROLES, type RubricModel } from '@soe/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { RubricsService } from './rubrics.service';

@Controller('rubrics')
@UseGuards(RolesGuard)
export class RubricsController {
  constructor(private readonly service: RubricsService) {}

  @Get(':id')
  @Roles(...ITEM_VIEWER_ROLES)
  getById(@Param('id') id: string, @CurrentUser() user: JwtPayload): Promise<RubricModel> {
    return this.service.getById(user, id);
  }
}
