import type { UserRole } from '@soe/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface ExecutiveSummaryProps {
  director: string;
  teacher: string;
  activeRole: UserRole;
}

/**
 * Síntesis ejecutiva adaptativa (H20.2): se prioriza la narrativa según el rol
 * activo. El profesor ve el accionable de aula primero; el resto ve la mirada de
 * gestión primero. La otra perspectiva queda disponible como complemento.
 */
export function ExecutiveSummary({ director, teacher, activeRole }: ExecutiveSummaryProps) {
  const isTeacher = activeRole === 'teacher';

  const primary = isTeacher
    ? { label: 'Para el aula', text: teacher }
    : { label: 'Para la gestión', text: director };
  const secondary = isTeacher
    ? { label: 'Mirada de gestión', text: director }
    : { label: 'Accionable de aula', text: teacher };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Síntesis ejecutiva
          <Badge variant="secondary">
            {isTeacher ? 'Vista profesor' : 'Vista directivo'}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">{primary.label}</p>
          <p className="text-sm leading-relaxed text-muted-foreground">{primary.text}</p>
        </div>
        <div className="space-y-1 border-t pt-4">
          <p className="text-sm font-medium text-muted-foreground">{secondary.label}</p>
          <p className="text-sm leading-relaxed text-muted-foreground">{secondary.text}</p>
        </div>
      </CardContent>
    </Card>
  );
}
