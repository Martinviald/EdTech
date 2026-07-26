import type { Config } from 'tailwindcss';
import defaultTheme from 'tailwindcss/defaultTheme';

const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: { '2xl': '1400px' },
    },
    extend: {
      fontFamily: {
        sans: ['var(--font-inter)', ...defaultTheme.fontFamily.sans],
      },
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        success: {
          DEFAULT: 'hsl(var(--success))',
          foreground: 'hsl(var(--success-foreground))',
        },
        warning: {
          DEFAULT: 'hsl(var(--warning))',
          foreground: 'hsl(var(--warning-foreground))',
        },
        info: {
          DEFAULT: 'hsl(var(--info))',
          foreground: 'hsl(var(--info-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        // Tokens de dominio · 4 niveles de logro (audit H2).
        // Habilitan `bg-level-adequate`, `text-level-advanced`, etc.
        'level-insufficient': {
          DEFAULT: 'hsl(var(--level-insufficient))',
          foreground: 'hsl(var(--level-insufficient-foreground))',
        },
        'level-elementary': {
          DEFAULT: 'hsl(var(--level-elementary))',
          foreground: 'hsl(var(--level-elementary-foreground))',
        },
        'level-adequate': {
          DEFAULT: 'hsl(var(--level-adequate))',
          foreground: 'hsl(var(--level-adequate-foreground))',
        },
        'level-advanced': {
          DEFAULT: 'hsl(var(--level-advanced))',
          foreground: 'hsl(var(--level-advanced-foreground))',
        },
        // Paleta categórica (--cat-*): habilita `bg-cat-1`, `text-cat-3`, etc.
        'cat-1': 'hsl(var(--cat-1))',
        'cat-2': 'hsl(var(--cat-2))',
        'cat-3': 'hsl(var(--cat-3))',
        'cat-4': 'hsl(var(--cat-4))',
        'cat-5': 'hsl(var(--cat-5))',
        'cat-6': 'hsl(var(--cat-6))',
      },
      borderRadius: {
        xl: 'calc(var(--radius) + 4px)',
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      // Elevación: sombras suaves y en capas, baja opacidad, tinte indigo-950.
      // Sobrescriben la escala por defecto → `shadow-sm`/`shadow-md`/… se modernizan.
      boxShadow: {
        sm: '0 1px 2px 0 rgb(15 23 42 / 0.04), 0 1px 3px 0 rgb(15 23 42 / 0.06)',
        DEFAULT: '0 1px 2px 0 rgb(15 23 42 / 0.04), 0 2px 6px -1px rgb(15 23 42 / 0.07)',
        md: '0 2px 4px -1px rgb(15 23 42 / 0.05), 0 8px 16px -4px rgb(30 27 75 / 0.10)',
        lg: '0 4px 8px -2px rgb(15 23 42 / 0.06), 0 16px 32px -8px rgb(30 27 75 / 0.14)',
        xl: '0 8px 16px -4px rgb(15 23 42 / 0.08), 0 24px 48px -12px rgb(30 27 75 / 0.18)',
        // Halo de color en la marca (sigue a --primary). Para el CTA principal.
        glow: '0 1px 2px 0 hsl(var(--primary) / 0.20), 0 6px 20px -4px hsl(var(--primary) / 0.45)',
      },
      // Motion consistente.
      transitionDuration: {
        fast: '120ms',
        base: '180ms',
        slow: '280ms',
      },
      transitionTimingFunction: {
        'out-soft': 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
      // Barra de progreso indeterminada (pending de filtros/navegación).
      keyframes: {
        'progress-indeterminate': {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(400%)' },
        },
      },
      animation: {
        'progress-indeterminate': 'progress-indeterminate 1.1s ease-in-out infinite',
      },
      // Escala de apilamiento para superficies flotantes (Fase 1 overlays).
      zIndex: {
        sticky: '30',
        dropdown: '40',
        modal: '50',
        popover: '60',
        toast: '70',
      },
      // Tipografía tokenizada. `2xs` cierra los `text-[10px]/[11px]` sueltos;
      // los roles (display/heading/title/body/caption) dan una escala nombrada.
      fontSize: {
        '2xs': ['0.625rem', { lineHeight: '0.875rem' }],
        display: ['2.25rem', { lineHeight: '2.5rem', letterSpacing: '-0.02em', fontWeight: '700' }],
        heading: ['1.875rem', { lineHeight: '2.25rem', letterSpacing: '-0.015em', fontWeight: '700' }],
        title: ['1.25rem', { lineHeight: '1.75rem', letterSpacing: '-0.01em', fontWeight: '600' }],
        body: ['1rem', { lineHeight: '1.5rem' }],
        caption: ['0.75rem', { lineHeight: '1rem' }],
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};

export default config;
