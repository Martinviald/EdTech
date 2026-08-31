import { BadRequestException } from '@nestjs/common';
import type { ZodType, ZodTypeDef } from 'zod';

export function parseDtoOrBadRequest<Output, Input>(
  schema: ZodType<Output, ZodTypeDef, Input>,
  input: unknown,
): Output {
  const parsed = schema.safeParse(input);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  const path = issue !== undefined && issue.path.length > 0 ? issue.path.join('.') : null;
  throw new BadRequestException(
    `Solicitud inválida${path !== null ? ` en "${path}"` : ''}: ${issue?.message ?? 'datos no válidos'}`,
  );
}
