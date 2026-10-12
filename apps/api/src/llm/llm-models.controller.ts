import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import {
  createLlmModelSchema,
  LLM_MODELS_ADMIN_ROLES,
  updateLlmModelSchema,
  type LlmModel,
  type LlmModelListResponse,
} from '@soe/types';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { parseDtoOrBadRequest } from '../common/helpers/parse-dto.helper';
import { LlmModelsService } from './llm-models.service';

const llmModelIdParamSchema = z.string().uuid();

@Controller('llm-models')
@UseGuards(RolesGuard)
@Roles(...LLM_MODELS_ADMIN_ROLES)
export class LlmModelsController {
  constructor(private readonly models: LlmModelsService) {}

  @Get()
  list(): Promise<LlmModelListResponse> {
    return this.models.listAll();
  }

  @Post()
  create(@Body() body: unknown): Promise<LlmModel> {
    return this.models.create(parseDtoOrBadRequest(createLlmModelSchema, body));
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: unknown): Promise<LlmModel> {
    return this.models.update(
      parseDtoOrBadRequest(llmModelIdParamSchema, id),
      parseDtoOrBadRequest(updateLlmModelSchema, body),
    );
  }
}
