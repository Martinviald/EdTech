import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

interface FieldProps {
  label: string;
  /** id del control para asociar el <label> (htmlFor). */
  htmlFor?: string;
  required?: boolean;
  /** Texto de ayuda bajo el control. */
  hint?: string;
  /** Mensaje de error; cuando está presente reemplaza al hint. */
  error?: string;
  children: React.ReactNode;
  className?: string;
}

/**
 * Grupo de formulario estándar: label (+ marca de requerido) + control +
 * hint/error. Promueve el patrón `Field` que estaba duplicado localmente en
 * ProfileForm a un componente compartido para todos los forms y dialogs.
 */
export function Field({
  label,
  htmlFor,
  required,
  hint,
  error,
  children,
  className,
}: FieldProps) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {required ? <span className="ml-0.5 text-destructive">*</span> : null}
      </Label>
      {children}
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
