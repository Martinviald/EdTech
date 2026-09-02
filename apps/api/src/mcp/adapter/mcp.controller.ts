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
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { AnyZodObject } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { Public } from '../../common/decorators/public.decorator';
import { reportServerError } from '../../common/observability/report-error';
import { McpAuthGuard } from '../auth/mcp-auth.guard';
import type { AnalyticsPrincipal } from '../core/analytics-principal';
import { AnalyticsToolsFacade } from '../core/analytics-tools.facade';
import { PromptRegistry } from '../core/prompt-registry';
import { ResourceRegistry } from '../core/resource-registry';
import { McpThrottlerGuard } from './mcp-throttler.guard';

const SERVER_INFO = { name: 'academos-analitico', version: '0.1.0' };

const ORG_CONTEXT_EXEMPT_TOOLS = new Set(['whoami', 'list_my_orgs', 'set_active_org']);

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
@UseGuards(McpAuthGuard, McpThrottlerGuard)
@Controller('mcp')
export class McpController {
  constructor(
    private readonly facade: AnalyticsToolsFacade,
    private readonly prompts: PromptRegistry,
    private readonly resources: ResourceRegistry,
  ) {}

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

  private orgContextFor(
    name: string,
    principal: AnalyticsPrincipal,
  ): { orgId: string; orgName: string | null } | null {
    if (ORG_CONTEXT_EXEMPT_TOOLS.has(name) || !principal.orgId) {
      return null;
    }
    return { orgId: principal.orgId, orgName: principal.orgName ?? null };
  }

  private buildServer(principal: AnalyticsPrincipal): Server {
    const server = new Server(SERVER_INFO, {
      capabilities: { tools: {}, prompts: {}, resources: {} },
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
        const orgContext = this.orgContextFor(name, principal);
        const text = orgContext
          ? `Organización: ${orgContext.orgName ?? orgContext.orgId} (${orgContext.orgId})\n${JSON.stringify(result)}`
          : JSON.stringify(result);
        return {
          content: [{ type: 'text', text }],
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

    server.setRequestHandler(ListPromptsRequestSchema, async () => ({
      prompts: this.prompts.listVisible(principal).map((descriptor) => ({
        name: descriptor.name,
        description: descriptor.description,
        arguments: descriptor.arguments,
      })),
    }));

    server.setRequestHandler(GetPromptRequestSchema, async (request) => {
      const prompt = this.prompts.get(request.params.name);
      if (!prompt) {
        throw new Error(`Prompt desconocido: ${request.params.name}`);
      }
      return {
        description: prompt.descriptor.description,
        messages: prompt.render(request.params.arguments ?? {}).map((message) => ({
          role: message.role,
          content: { type: 'text' as const, text: message.text },
        })),
      };
    });

    server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: [] }));

    server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
      resourceTemplates: this.resources.listVisible(principal).map((descriptor) => ({
        uriTemplate: descriptor.uriTemplate,
        name: descriptor.name,
        description: descriptor.description,
        mimeType: descriptor.mimeType,
      })),
    }));

    server.setRequestHandler(ReadResourceRequestSchema, async (request) => ({
      contents: [await this.resources.read(principal, request.params.uri)],
    }));

    return server;
  }
}
