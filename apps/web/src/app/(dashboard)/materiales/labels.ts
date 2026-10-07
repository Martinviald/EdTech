import type {
  DocumentStatus,
  DocumentType,
  DocumentVisibility,
  MaterialOrigin,
  RemedialStatus,
} from '@soe/types';
import type { StatusTone } from '@/components/shared/StatusBadge';

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

export const DOCUMENT_STATUS_TONES: Record<DocumentStatus, StatusTone> = {
  draft: 'warning',
  published: 'success',
  archived: 'neutral',
};

export const MATERIAL_ORIGIN_LABELS: Record<MaterialOrigin, string> = {
  remedial: 'Generado por IA · Remedial',
  instrument: 'Desde instrumento',
  document: 'Copia de documento',
  blank: 'En blanco',
};

export const LIBRARY_REMEDIAL_STATUS_LABELS: Record<RemedialStatus, string> = {
  pending: 'Generando',
  processing: 'Generando',
  ready: 'Por revisar',
  approved: 'Aprobado',
  failed: 'Falló',
  discarded: 'Descartado',
};

export const LIBRARY_REMEDIAL_STATUS_TONES: Record<RemedialStatus, StatusTone> = {
  pending: 'info',
  processing: 'info',
  ready: 'warning',
  approved: 'success',
  failed: 'danger',
  discarded: 'neutral',
};
