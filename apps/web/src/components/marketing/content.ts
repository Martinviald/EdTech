import type { LucideIcon } from 'lucide-react';

import { ROUTES } from '@/lib/routes';
import {
  AlertTriangle,
  BarChart3,
  ClipboardCheck,
  FileSpreadsheet,
  GraduationCap,
  LayoutDashboard,
  LineChart,
  ScanLine,
  Sparkles,
  Target,
  Upload,
  Users,
} from 'lucide-react';

/** Enlaces de navegación (anclas dentro de la landing). */
export const NAV_LINKS = [
  { label: 'Producto', href: '#producto' },
  { label: 'Cómo funciona', href: '#como-funciona' },
  { label: 'Para ti', href: '#para-ti' },
  { label: 'Precios', href: '#precios' },
] as const;

/** Destino del CTA principal (login SSO existente). */
export const PRIMARY_CTA_HREF = ROUTES.login;

export interface PainPoint {
  icon: LucideIcon;
  title: string;
  description: string;
}

/** Sección "el problema": el status quo del colegio sin la plataforma. */
export const PAIN_POINTS: PainPoint[] = [
  {
    icon: AlertTriangle,
    title: 'Deciden a ciegas',
    description:
      'Los resultados viven en planillas dispersas. Para cuando se consolidan, ya es tarde para intervenir.',
  },
  {
    icon: ClipboardCheck,
    title: 'Tabular consume el tiempo docente',
    description:
      'Corregir y digitar el DIA a mano puede tomar semanas. Tiempo que debería ir a enseñar.',
  },
  {
    icon: FileSpreadsheet,
    title: 'Datos sin inteligencia',
    description:
      'Una nota no dice qué habilidad falló ni por qué. El Excel guarda números, no aprendizajes.',
  },
];

export interface Feature {
  icon: LucideIcon;
  title: string;
  description: string;
  badge?: string;
}

/** Capacidades reales de F1. */
export const FEATURES: Feature[] = [
  {
    icon: Upload,
    title: 'Ingesta DIA automática',
    description:
      'Carga las hojas de respuesta (CSV de Gradecam, ZipGrade u oficial) y obtén resultados corregidos contra la pauta oficial en minutos.',
  },
  {
    icon: ClipboardCheck,
    title: 'Banco de ítems',
    description:
      'Cada ítem mapeado a sus Objetivos de Aprendizaje (OA) y habilidades MINEDUC. La base reutilizable de toda evaluación.',
  },
  {
    icon: LayoutDashboard,
    title: 'Dashboard directivo',
    description:
      'Visibilidad macro de toda la organización: logro por curso, asignatura y habilidad, con alertas de alumnos críticos.',
  },
  {
    icon: BarChart3,
    title: 'Dashboard profesor',
    description:
      'Diagnóstico por habilidad acotado a tus cursos. Identifica al instante qué OA reforzar y con quiénes.',
  },
  {
    icon: Target,
    title: 'Análisis de distractores',
    description:
      'No solo qué se equivocaron, sino por qué: qué alternativa eligieron y qué error conceptual revela.',
  },
  {
    icon: LineChart,
    title: 'Comparación de generaciones',
    description:
      'Contrasta el DIA de este año con cohortes anteriores y detecta tendencias de aprendizaje en el tiempo.',
  },
];

export interface Step {
  icon: LucideIcon;
  step: string;
  title: string;
  description: string;
}

/** "Cómo funciona": del dato crudo a la inteligencia pedagógica. */
export const STEPS: Step[] = [
  {
    icon: Upload,
    step: '01',
    title: 'Sube la pauta DIA',
    description:
      'Importas la pauta oficial y la plataforma la interpreta y mapea automáticamente a OA y habilidades.',
  },
  {
    icon: ScanLine,
    step: '02',
    title: 'Carga las respuestas',
    description:
      'Subes el CSV con las respuestas del curso completo. Sin digitar alumno por alumno.',
  },
  {
    icon: Sparkles,
    step: '03',
    title: 'Obtén inteligencia pedagógica',
    description:
      'Dashboards con logro por habilidad, distractores y alertas, listos para tomar decisiones y exportar.',
  },
];

export interface AudienceValue {
  icon: LucideIcon;
  title: string;
  points: string[];
}

/** Propuesta de valor segmentada por rol. */
export const AUDIENCES: AudienceValue[] = [
  {
    icon: GraduationCap,
    title: 'Para directivos',
    points: [
      'Visibilidad en tiempo real de toda la organización',
      'Mapa de calor de logro por habilidad y curso',
      'Alertas tempranas de alumnos en riesgo',
      'Reportes descargables (PDF/Excel) para el equipo',
    ],
  },
  {
    icon: Users,
    title: 'Para profesores',
    points: [
      'Corrección del DIA sin fricción ni tabulación manual',
      'Diagnóstico de las habilidades específicas a reforzar',
      'Análisis de distractores por pregunta',
      'Histórico longitudinal del avance de cada alumno',
    ],
  },
];

export interface AiCapability {
  title: string;
  description: string;
  available: boolean;
}

/** Ángulo IA: honesto con F1. Lo disponible hoy vs. el roadmap. */
export const AI_CAPABILITIES: AiCapability[] = [
  {
    title: 'Etiquetado IA de ítems',
    description:
      'La IA sugiere los OA y habilidades de cada ítem; un administrador siempre confirma antes de guardar.',
    available: true,
  },
  {
    title: 'Material remedial con IA',
    description:
      'Genera guías personalizadas según las áreas débiles detectadas en el diagnóstico.',
    available: false,
  },
  {
    title: 'Corrección IA de desarrollo',
    description:
      'AI Grading de preguntas abiertas con visión multimodal, manteniendo el override humano.',
    available: false,
  },
  {
    title: 'Benchmarking institucional',
    description:
      'Comparación anónima entre colegios de la red para situar tus resultados en contexto.',
    available: false,
  },
];

export interface PlanFeature {
  text: string;
  included: boolean;
}

export interface PricingPlan {
  name: string;
  price: string;
  priceNote: string;
  description: string;
  features: PlanFeature[];
  ctaLabel: string;
  highlighted: boolean;
}

/** Teaser de pricing freemium (PLG "caballo de Troya"). */
export const PRICING_PLANS: PricingPlan[] = [
  {
    name: 'Gratis',
    price: '$0',
    priceNote: 'para empezar',
    description: 'El dolor del DIA resuelto, sin costo. Tu punto de entrada.',
    features: [
      { text: 'Ingesta DIA ilimitada', included: true },
      { text: 'Banco de ítems con OA y habilidades', included: true },
      { text: 'Dashboards de directivo y profesor', included: true },
      { text: 'Exportación a PDF y Excel', included: true },
    ],
    ctaLabel: 'Importa tu DIA gratis',
    highlighted: true,
  },
  {
    name: 'Premium',
    price: 'Próximamente',
    priceNote: '',
    description: 'La inteligencia que convierte datos en aprendizaje.',
    features: [
      { text: 'Material remedial generado con IA', included: false },
      { text: 'AI Grading de preguntas de desarrollo', included: false },
      { text: 'Benchmarking entre colegios', included: false },
      { text: 'Predicción de brechas de aprendizaje', included: false },
    ],
    ctaLabel: 'Hablar con el equipo',
    highlighted: false,
  },
];
