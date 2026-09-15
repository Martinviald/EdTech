'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';

type SwitchProps = Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  'onChange' | 'type' | 'role' | 'aria-checked'
> & {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
};

/**
 * Interruptor accesible (`role="switch"`) sin dependencia extra: mismo contrato
 * que el `Switch` de shadcn/ui (`checked`, `onCheckedChange`), estilizado con
 * tokens semánticos. Controlado si recibe `checked`; si no, guarda su estado.
 */
const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  (
    { className, checked, defaultChecked = false, onCheckedChange, disabled, onClick, ...props },
    ref,
  ) => {
    const [internalChecked, setInternalChecked] = React.useState(defaultChecked);
    const isControlled = checked !== undefined;
    const isChecked = isControlled ? checked : internalChecked;

    return (
      <button
        ref={ref}
        type="button"
        role="switch"
        aria-checked={isChecked}
        data-state={isChecked ? 'checked' : 'unchecked'}
        disabled={disabled}
        onClick={(event) => {
          onClick?.(event);
          if (event.defaultPrevented) return;
          const next = !isChecked;
          if (!isControlled) setInternalChecked(next);
          onCheckedChange?.(next);
        }}
        className={cn(
          'peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent shadow-sm transition-colors duration-fast ease-out-soft motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50',
          isChecked ? 'bg-primary' : 'bg-input',
          className,
        )}
        {...props}
      >
        <span
          aria-hidden
          className={cn(
            'pointer-events-none block size-5 rounded-full bg-background shadow-lg ring-0 transition-transform duration-fast ease-out-soft motion-reduce:transition-none',
            isChecked ? 'translate-x-5' : 'translate-x-0',
          )}
        />
      </button>
    );
  },
);
Switch.displayName = 'Switch';

export { Switch };
