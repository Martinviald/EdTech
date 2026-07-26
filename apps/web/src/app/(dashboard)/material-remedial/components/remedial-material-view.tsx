'use client';

import { useState } from 'react';
import { GraduationCap, Printer, User } from 'lucide-react';
import {
  type RemedialAudience,
  type RemedialContent,
  type RemedialMaterialModel,
  type RemedialStudentContent,
} from '@soe/types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { AlertCallout } from '@/components/shared';
import { ContentDisplay } from './content-display';
import { StudentContentDisplay } from './student-content-display';
import { ReviewPanel } from './review-panel';
import { REMEDIAL_TYPE_LABELS } from './labels';

interface RemedialMaterialViewProps {
  material: RemedialMaterialModel;
  /** Contenido EFECTIVO para el profesor (editedContent ?? content). */
  teacherContent: RemedialContent;
  /** Versión estudiante derivada en backend (GET /:id/student). */
  studentContent: RemedialStudentContent | null;
  canApprove: boolean;
  title: string;
}

/**
 * Orquestador de la vista de un material remedial ya generado (TKT-17):
 * - Toggle Profesor / Estudiante: mismo material, dos renders. La versión
 *   profesor incluye todo (y edición/aprobación en borrador); la estudiante
 *   oculta la información solo-profesor.
 * - Imprimible: `window.print()` sobre una vista limpia (`.print-region` +
 *   `@media print`), tanto para la versión profesor como la estudiante.
 * La edición sigue el flujo humano-aprueba (§8.3) dentro de `ReviewPanel`.
 */
export function RemedialMaterialView({
  material,
  teacherContent,
  studentContent,
  canApprove,
  title,
}: RemedialMaterialViewProps) {
  const [audience, setAudience] = useState<RemedialAudience>('teacher');

  const typeLabel = REMEDIAL_TYPE_LABELS[material.type];
  const subtitle = [typeLabel, material.nodeName].filter(Boolean).join(' · ');
  const audienceLabel = audience === 'teacher' ? 'Versión profesor' : 'Versión estudiante';

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 no-print sm:flex-row sm:items-center sm:justify-between">
        <div
          role="tablist"
          aria-label="Audiencia del material"
          className="inline-flex rounded-lg border bg-muted/40 p-1"
        >
          <AudienceTab
            active={audience === 'teacher'}
            onClick={() => setAudience('teacher')}
            icon={User}
            label="Profesor"
          />
          <AudienceTab
            active={audience === 'student'}
            onClick={() => setAudience('student')}
            icon={GraduationCap}
            label="Estudiante"
          />
        </div>

        <Button variant="outline" size="sm" onClick={() => window.print()}>
          <Printer className="size-4" aria-hidden />
          Imprimir
        </Button>
      </div>

      <div className="print-region">
        {/* Cabecera visible sólo al imprimir: identifica el material y la versión. */}
        <div className="mb-6 hidden border-b pb-4 print:block">
          <h1 className="text-xl font-semibold text-foreground">{title}</h1>
          {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
          <p className="mt-1 text-sm font-medium text-muted-foreground">{audienceLabel}</p>
        </div>

        {audience === 'teacher' ? (
          <TeacherPane material={material} content={teacherContent} canApprove={canApprove} />
        ) : studentContent ? (
          <StudentContentDisplay content={studentContent} />
        ) : (
          <AlertCallout tone="warning">
            Aún no hay una versión para el estudiante de este material.
          </AlertCallout>
        )}
      </div>
    </div>
  );
}

function AudienceTab({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof User;
  label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition',
        active
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      <Icon className="size-4" aria-hidden />
      {label}
    </button>
  );
}

function TeacherPane({
  material,
  content,
  canApprove,
}: {
  material: RemedialMaterialModel;
  content: RemedialContent;
  canApprove: boolean;
}) {
  if (material.status === 'ready') {
    return <ReviewPanel material={material} content={content} canApprove={canApprove} />;
  }

  return (
    <div className="space-y-4">
      {material.status === 'approved' ? (
        <AlertCallout tone="success" title="Material aprobado" className="no-print">
          Este material fue revisado y aprobado por un responsable.
        </AlertCallout>
      ) : material.status === 'discarded' ? (
        <AlertCallout tone="warning" title="Material descartado" className="no-print">
          Este material fue descartado y no se usará en aula.
        </AlertCallout>
      ) : null}
      <ContentDisplay
        content={content}
        practiceItems={material.practiceItems}
        stimuli={material.stimuli}
        qualityReport={material.qualityReport}
      />
    </div>
  );
}
