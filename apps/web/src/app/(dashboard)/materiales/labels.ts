import type { DocumentStatus, DocumentType, DocumentVisibility } from '@soe/types';

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  guide: 'Guía de trabajo',
  worksheet: 'Guía de ejercitación',
  assessment: 'Evaluación imprimible',
  generic: 'Documento libre',
};

export const DOCUMENT_STATUS_LABELS: Record<DocumentStatus, string> = {
  draft: 'Borrador',
  published: 'Publicado',
  archived: 'Archivado',
};

export const DOCUMENT_VISIBILITY_LABELS: Record<DocumentVisibility, string> = {
  private: 'Privado',
  department: 'Departamento',
  org: 'Colegio',
  network: 'Red',
  platform: 'Plataforma',
};

export const DOCUMENT_STATUS_TONES: Record<
  DocumentStatus,
  'success' | 'warning' | 'info' | 'neutral' | 'danger'
> = {
  draft: 'warning',
  published: 'success',
  archived: 'neutral',
};
