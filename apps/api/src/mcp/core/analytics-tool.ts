import { SetMetadata } from '@nestjs/common';
import type { AnyZodObject } from 'zod';
import type { FeatureKey, UserRole } from '@soe/types';
import type { AnalyticsPrincipal } from './analytics-principal';

export type PiiLevel = 'aggregate' | 'individual';

export interface ToolDescriptor {
  name: string;
  description: string;
  inputSchema: AnyZodObject;
  outputSchema?: AnyZodObject;
  requiredRoles: readonly UserRole[];
  requiredFeature?: FeatureKey;
  piiLevel: PiiLevel;
}

export interface AnalyticsTool<TInput = unknown, TOutput = unknown> {
  readonly descriptor: ToolDescriptor;
  execute(principal: AnalyticsPrincipal, input: TInput): Promise<TOutput>;
}

export const ANALYTICS_TOOL_METADATA = 'soe:analytics-tool';

export const AnalyticsTool = () => SetMetadata(ANALYTICS_TOOL_METADATA, true);
