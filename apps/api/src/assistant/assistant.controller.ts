import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  assistantConversationListQuerySchema,
  createAssistantConversationSchema,
  sendAssistantMessageSchema,
  ASSISTANT_USER_ROLES,
  type AssistantConversationDetail,
  type AssistantConversationListResponse,
  type AssistantConversationModel,
} from '@soe/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { RequireFeature } from '../common/decorators/feature.decorator';
import { FeatureGuard } from '../common/guards/feature.guard';
import { AssistantService } from './assistant.service';

/**
 * API del Asistente IA Conversacional (E21 — H21.7/H21.8).
 *
 * Gating: rol directivo (`ASSISTANT_USER_ROLES`, autorizado por unión en
 * `RolesGuard`) + feature de tier pago `ai_assistant` (`FeatureGuard`). El
 * `orgId`/roles SIEMPRE del token (en el service), nunca del body.
 *
 * El endpoint de mensajes responde con STREAMING SSE escrito manualmente sobre
 * el `Response` de Express: el cliente hace POST con body (`{ content,
 * pageContext }`), por lo que `@Sse()` (GET + EventSource) no encaja. El frontend
 * consume con `fetch` + `response.body.getReader()` (ver planificación §3.4/§6).
 */
@Controller('assistant')
@UseGuards(RolesGuard, FeatureGuard)
@RequireFeature('ai_assistant')
@Roles(...ASSISTANT_USER_ROLES)
export class AssistantController {
  constructor(private readonly service: AssistantService) {}

  /** POST /api/assistant/conversations — crea un hilo de chat. */
  @Post('conversations')
  createConversation(
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ): Promise<AssistantConversationModel> {
    const dto = createAssistantConversationSchema.parse(body);
    return this.service.createConversation(user, dto);
  }

  /** GET /api/assistant/conversations — listado paginado del usuario. */
  @Get('conversations')
  listConversations(
    @Query() query: unknown,
    @CurrentUser() user: JwtPayload,
  ): Promise<AssistantConversationListResponse> {
    const dto = assistantConversationListQuerySchema.parse(query);
    return this.service.listConversations(user, dto);
  }

  /** GET /api/assistant/conversations/:id — conversación + mensajes. */
  @Get('conversations/:id')
  getConversation(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<AssistantConversationDetail> {
    return this.service.getConversation(user, id);
  }

  /** DELETE /api/assistant/conversations/:id — soft delete. */
  @Delete('conversations/:id')
  @HttpCode(204)
  async deleteConversation(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<void> {
    await this.service.deleteConversation(user, id);
  }

  /**
   * POST /api/assistant/conversations/:id/messages — envía un mensaje y
   * responde la generación del asistente como stream SSE.
   *
   * Cada evento del loop (`text_delta`, `tool_call`, `tool_result`) se escribe
   * como un frame `data: <json>\n\n`. El evento `final` no se reenvía (la
   * persistencia ocurre en el service); al cerrar se emite `{ type: 'done' }`.
   */
  @Post('conversations/:id/messages')
  async sendMessage(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
    @Res() res: Response,
  ): Promise<void> {
    const dto = sendAssistantMessageSchema.parse(body);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const write = (event: unknown): void => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    try {
      for await (const event of this.service.streamReply(user, id, dto)) {
        if (event.type !== 'final') write(event);
      }
      write({ type: 'done' });
    } catch (err) {
      // El stream ya está abierto (200): un throw no puede convertirse en un
      // status de error HTTP, así que emitimos el error dentro del propio SSE.
      const message = err instanceof Error ? err.message : 'Error inesperado del asistente';
      write({ type: 'error', message });
    } finally {
      res.end();
    }
  }
}
