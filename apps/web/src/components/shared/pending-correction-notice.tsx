import { ClipboardCheck } from 'lucide-react';
import { AlertCallout } from './AlertCallout';

/**
 * Aviso de que hay alumnos con preguntas todavía sin corregir: su % de logro considera sólo lo
 * corregido (docs/diseno-logro-unificado-y-cohorte.md §3.1, D6). No se muestra si son 0.
 */
export function PendingCorrectionNotice({ studentCount }: { studentCount: number }) {
  if (!(studentCount > 0)) return null;
  const who = studentCount === 1 ? '1 alumno tiene' : `${studentCount} alumnos tienen`;
  return (
    <AlertCallout tone="info" icon={ClipboardCheck} title="Preguntas por corregir">
      {who} preguntas todavía sin corregir. Su % de logro considera sólo lo que ya está corregido y
      puede cambiar cuando se termine la corrección.
    </AlertCallout>
  );
}
