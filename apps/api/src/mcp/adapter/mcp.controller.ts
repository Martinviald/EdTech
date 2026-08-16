import {
  Controller,
  Delete,
  Get,
  HttpException,
  MethodNotAllowedException,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { AnyZodObject } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { Public } from '../../common/decorators/public.decorator';
import { reportServerError } from '../../common/observability/report-error';
import { McpAuthGuard } from '../auth/mcp-auth.guard';
import type { AnalyticsPrincipal } from '../core/analytics-principal';
import { AnalyticsToolsFacade } from '../core/analytics-tools.facade';

const SERVER_INFO = { name: 'academos-analitico', version: '0.1.0' };

const SERVER_INSTRUCTIONS =
  'Servidor analítico de AcademOS (solo lectura). Expone instrumentos, evaluaciones, ' +
  'resultados y brechas de aprendizaje de la organización del usuario autenticado. ' +
  'Para contrastar resultados contra la calidad del instrumento, combina ' +
  'get_instrument_blueprint (dificultad declarada), get_item_statistics (dificultad ' +
  'empírica) y get_skill_gaps (brechas por habilidad).';

type JsonSchemaObject = { type: 'object'; [key: string]: unknown };

const convertZodSchema = zodToJsonSchema as unknown as (
  schema: AnyZodObject,
  options: { $refStrategy: 'none' },
) => JsonSchemaObject;

function toJsonSchema(schema: AnyZodObject): JsonSchemaObject {
  return convertZodSchema(schema, { $refStrategy: 'none' });
}

interface AuthenticatedRequest extends Request {
  user: AnalyticsPrincipal;
}

@Public()
@UseGuards(McpAuthGuard)
@Controller('mcp')
export class McpController {
  constructor(private readonly facade: AnalyticsToolsFacade) {}

  @Post()
  async handle(@Req() req: AuthenticatedRequest, @Res() res: Response): Promise<void> {
    const server = this.buildServer(req.user);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  }

  @Get()
  rejectGet(): never {
    throw new MethodNotAllowedException('Servidor MCP stateless: solo POST');
  }

  @Delete()
  rejectDelete(): never {
    throw new MethodNotAllowedException('Servidor MCP stateless: solo POST');
  }

  private buildServer(principal: AnalyticsPrincipal): Server {
    const server = new Server(SERVER_INFO, {
      capabilities: { tools: {} },
      instructions: SERVER_INSTRUCTIONS,
    });

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.facade.listVisible(principal).map((descriptor) => ({
        name: descriptor.name,
        description: descriptor.description,
        inputSchema: toJsonSchema(descriptor.inputSchema),
        ...(descriptor.outputSchema
          ? { outputSchema: toJsonSchema(descriptor.outputSchema) }
          : {}),
      })),
    }));

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name } = request.params;
      const args = request.params.arguments ?? {};
      try {
        const result = await this.facade.execute(name, principal, args);
        const descriptor = this.facade
          .listVisible(principal)
          .find((candidate) => candidate.name === name);
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          ...(descriptor?.outputSchema
            ? { structuredContent: result as Record<string, unknown> }
            : {}),
        };
      } catch (error) {
        if (error instanceof HttpException) {
          return {
            isError: true,
            content: [{ type: 'text', text: JSON.stringify(error.getResponse()) }],
          };
        }
        reportServerError(error, {
          tool: name,
          userId: principal.userId,
          orgId: principal.orgId,
        });
        return {
          isError: true,
          content: [
            { type: 'text', text: JSON.stringify({ message: 'Error interno del servidor' }) },
          ],
        };
      }
    });

    return server;
  }
}
