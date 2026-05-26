/**
 * Re-export de los schemas/DTOs compartidos en `@soe/types`. Mantener este
 * archivo evita duplicación: la única fuente de verdad de validación vive
 * en `packages/types`.
 */
export {
  gradingScaleCreateSchema,
  gradingScaleUpdateSchema,
  gradingScaleListQuerySchema,
  gradingScalePreviewRequestSchema,
  type GradingScaleCreateDto,
  type GradingScaleUpdateDto,
  type GradingScaleListQueryDto,
  type GradingScalePreviewRequestDto,
  type GradingScaleResponseModel,
  type GradingScaleListResponse,
  type GradingScalePreviewResponse,
  type GradingScaleTypeValue,
} from '@soe/types';
