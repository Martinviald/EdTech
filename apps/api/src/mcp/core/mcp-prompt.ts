import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '@soe/types';

export interface McpPromptArgument {
  name: string;
  description: string;
  required: boolean;
}

export interface PromptMessage {
  role: 'user' | 'assistant';
  text: string;
}

export interface PromptDescriptor {
  name: string;
  description: string;
  arguments: McpPromptArgument[];
  requiredRoles: readonly UserRole[];
}

export interface McpPrompt {
  readonly descriptor: PromptDescriptor;
  render(args: Record<string, string>): PromptMessage[];
}

export const MCP_PROMPT_METADATA = 'soe:mcp-prompt';

export const McpPromptProvider = () => SetMetadata(MCP_PROMPT_METADATA, true);
