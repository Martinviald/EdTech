// Los schemas Zod viven en `@soe/types` (contrato compartido con web). Se
// re-exportan aquí para que el controller los consuma desde el barrel de DTOs
// del módulo (mismo patrón que el resto de módulos).
export {
  createFileUploadUrlRequestSchema,
  confirmFileSchema,
  updateFileSchema,
  fileQuerySchema,
} from '@soe/types';
export type {
  CreateFileUploadUrlRequestDto,
  ConfirmFileDto,
  UpdateFileDto,
  FileQueryDto,
} from '@soe/types';
