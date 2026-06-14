import {
  remedialGuideContentSchema,
  remedialPracticeContentSchema,
  remedialPlanContentSchema,
  type RemedialContent,
} from '@soe/types';
import { AlertCallout } from '@/components/patterns';
import { GuideView } from './guide-view';
import { PracticeView } from './practice-view';
import { PlanView } from './plan-view';

/**
 * Render de solo lectura del contenido de un material remedial, narrando por
 * schema (guía / set de práctica / plan por grupo). Se usa para materiales ya
 * aprobados o descartados (sin acciones).
 */
export function ContentDisplay({ content }: { content: RemedialContent }) {
  const guide = remedialGuideContentSchema.safeParse(content);
  if (guide.success) return <GuideView content={guide.data} />;

  const practice = remedialPracticeContentSchema.safeParse(content);
  if (practice.success) return <PracticeView content={practice.data} />;

  const plan = remedialPlanContentSchema.safeParse(content);
  if (plan.success) return <PlanView content={plan.data} />;

  return (
    <AlertCallout tone="danger">
      El contenido del material tiene un formato inesperado.
    </AlertCallout>
  );
}
