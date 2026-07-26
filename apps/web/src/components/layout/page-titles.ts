import { ROUTES } from '@/lib/routes';

/**
 * Título de una vista, tal como lo pinta la barra superior (`TopbarTitle`).
 * `parent` es el camino de vuelta (antes el `breadcrumb`/`BackLink` que cada
 * página renderizaba en su encabezado).
 */
export type PageTitle = {
  title: string;
  parent?: { href: string; label: string };
};

/**
 * Título por ruta. Es la fuente de verdad de los títulos de las vistas: desde
 * que el título vive en la barra superior (y no en el cuerpo de la página), el
 * layout necesita conocerlo ANTES de renderizar el contenido, y un layout de
 * Next no puede leer nada de sus páginas hijas.
 *
 * Ventaja de resolverlo por ruta: el título viaja en el HTML del servidor (sin
 * parpadeo al cargar). Las vistas cuyo título depende de datos (el nombre de la
 * evaluación, del instrumento, del curso…) declaran el suyo con `<SetPageTitle>`
 * y este mapa les da el respaldo genérico mientras hidrata.
 *
 * ⚠️ Al agregar una vista nueva hay que agregar acá su título.
 */
const STATIC_TITLES: Record<string, PageTitle> = {
  [ROUTES.dashboard]: { title: 'Inicio' },
  [ROUTES.myClasses]: { title: 'Mis cursos' },

  [ROUTES.evaluaciones]: { title: 'Evaluaciones' },

  // Vista 360 del estudiante: el picker usa este título estático; la ficha de un
  // alumno (`/estudiantes/[studentId]`) lo sobre-escribe con `<SetPageTitle>`.
  [ROUTES.estudiantes]: { title: 'Vista 360 del estudiante' },

  // Hub de Panorama pedagógico: todas las tabs comparten título (la tab activa
  // ya se identifica en la barra de pestañas del cuerpo).
  [ROUTES.resultados]: { title: 'Panorama pedagógico' },
  [ROUTES.resultadosClasificacion]: { title: 'Panorama pedagógico' },
  [ROUTES.resultadosDimensiones]: { title: 'Panorama pedagógico' },
  [ROUTES.resultadosMapaCalor]: { title: 'Panorama pedagógico' },
  [ROUTES.resultadosComparacion]: { title: 'Panorama pedagógico' },
  [ROUTES.resultadosProgresion]: { title: 'Panorama pedagógico' },

  // Hub del Banco de contenido (tabs Instrumentos / Ítems).
  [ROUTES.bancoItems]: { title: 'Banco de contenido' },
  [ROUTES.bancoItemsExplorar]: { title: 'Banco de contenido' },
  [ROUTES.bancoItemsNuevo]: {
    title: 'Crear instrumento',
    parent: { href: ROUTES.bancoItems, label: 'Banco de contenido' },
  },

  [ROUTES.importar]: { title: 'Importar' },
  [ROUTES.importarAlumnos]: { title: 'Importar alumnos', parent: importarParent() },
  [ROUTES.importarInstrumento]: { title: 'Importar pauta DIA', parent: importarParent() },
  [ROUTES.importarResultados]: { title: 'Importar resultados', parent: importarParent() },
  [ROUTES.importarResultadosCargar]: {
    title: 'Cargar archivo de respuestas',
    parent: { href: ROUTES.importarResultados, label: 'Importar resultados' },
  },
  [ROUTES.importarResultadosPreview]: {
    title: 'Previsualización',
    parent: { href: ROUTES.importarResultados, label: 'Importar resultados' },
  },

  [ROUTES.administracion]: { title: 'Administración' },
  [ROUTES.benchmarking]: { title: 'Benchmarking' },
  [ROUTES.compararInstrumentos]: { title: 'Comparar instrumentos con IA' },
  [ROUTES.materialRemedial]: { title: 'Material Remedial' },
  [ROUTES.establecimientoInformeOficial]: { title: 'Informe oficial de establecimiento' },

  [ROUTES.equipo]: { title: 'Equipo', parent: adminHubParent() },
  [ROUTES.marcosAcademicos]: { title: 'Marcos Académicos', parent: adminHubParent() },

  [ROUTES.organizacion]: { title: 'Mi Colegio', parent: adminHubParent() },
  [ROUTES.organizacionAsignaciones]: { title: 'Mi Colegio', parent: adminHubParent() },
  [ROUTES.organizacionConfigurar]: {
    title: 'Configurar colegio',
    parent: { href: ROUTES.organizacion, label: 'Mi Colegio' },
  },

  // Hub de Configuración (tabs Escalas / Modelos IA / Observabilidad).
  [ROUTES.configEscalas]: { title: 'Configuración', parent: adminHubParent() },
  [ROUTES.configModelosIa]: { title: 'Configuración', parent: adminHubParent() },
  [ROUTES.configObservabilidadIa]: { title: 'Configuración', parent: adminHubParent() },
  [ROUTES.configEscalasNueva]: {
    title: 'Nueva escala de notas',
    parent: { href: ROUTES.configEscalas, label: 'Configuración' },
  },

  // Panel de plataforma (route group `(admin)`).
  [ROUTES.admin]: { title: 'Panel de plataforma' },
  [ROUTES.adminColegios]: { title: 'Colegios' },
  [ROUTES.adminEquipo]: { title: 'Equipo plataforma' },
  [ROUTES.adminInstrumentos]: { title: 'Instrumentos oficiales' },
  [ROUTES.adminInstrumentosBandas]: { title: 'Niveles de logro por instrumento' },
  [ROUTES.adminModelosIa]: { title: 'Modelos de IA' },
};

function importarParent() {
  return { href: ROUTES.importar, label: 'Importar' };
}

function adminHubParent() {
  return { href: ROUTES.administracion, label: 'Administración' };
}

/**
 * Rutas dinámicas: el título depende de un dato que el layout no tiene. Lo que
 * hay acá es el respaldo genérico (se ve mientras el servidor renderiza y hasta
 * que la vista declara el suyo con `<SetPageTitle>`). El orden importa: se
 * evalúan de más específica a más general.
 */
const DYNAMIC_TITLES: readonly { pattern: RegExp; resolve: (m: RegExpMatchArray) => PageTitle }[] =
  [
    {
      pattern: /^\/dashboard\/my-classes\/[^/]+$/,
      resolve: () => ({ title: 'Curso', parent: { href: ROUTES.myClasses, label: 'Mis cursos' } }),
    },
    {
      pattern: /^\/evaluaciones\/([^/]+)\/informe-alumno\/[^/]+$/,
      resolve: (m) => ({
        title: 'Informe del alumno',
        parent: { href: ROUTES.evaluacion(m[1]!), label: 'Evaluación' },
      }),
    },
    {
      // Todas las pestañas del hub de una evaluación comparten el título del hub.
      pattern: /^\/evaluaciones\/[^/]+(\/.*)?$/,
      resolve: () => ({
        title: 'Evaluación',
        parent: { href: ROUTES.evaluaciones, label: 'Evaluaciones' },
      }),
    },
    {
      pattern: /^\/banco-contenido\/([^/]+)\/spec-table\/cargar$/,
      resolve: (m) => ({
        title: 'Cargar tabla de especificaciones',
        parent: { href: ROUTES.bancoItemSpecTable(m[1]!), label: 'Tabla de especificaciones' },
      }),
    },
    {
      pattern: /^\/banco-contenido\/([^/]+)\/spec-table$/,
      resolve: (m) => ({
        title: 'Tabla de especificaciones',
        parent: { href: ROUTES.bancoItem(m[1]!), label: 'Instrumento' },
      }),
    },
    {
      pattern: /^\/banco-contenido\/([^/]+)\/etiquetar$/,
      resolve: (m) => ({
        title: 'Etiquetado con IA',
        parent: { href: ROUTES.bancoItem(m[1]!), label: 'Instrumento' },
      }),
    },
    {
      pattern: /^\/banco-contenido\/[^/]+$/,
      resolve: () => ({
        title: 'Instrumento',
        parent: { href: ROUTES.bancoItems, label: 'Banco de contenido' },
      }),
    },
    {
      pattern: /^\/importar\/resultados\/jobs\/[^/]+$/,
      resolve: () => ({
        title: 'Estado de la importación',
        parent: { href: ROUTES.importarResultados, label: 'Importar resultados' },
      }),
    },
    {
      pattern: /^\/marcos-academicos\/[^/]+$/,
      resolve: () => ({
        title: 'Marco académico',
        parent: { href: ROUTES.marcosAcademicos, label: 'Marcos Académicos' },
      }),
    },
    {
      pattern: /^\/material-remedial\/[^/]+$/,
      resolve: () => ({
        title: 'Material remedial',
        parent: { href: ROUTES.materialRemedial, label: 'Material Remedial' },
      }),
    },
    {
      pattern: /^\/configuracion\/escalas\/[^/]+$/,
      resolve: () => ({
        title: 'Escala de notas',
        parent: { href: ROUTES.configEscalas, label: 'Configuración' },
      }),
    },
    {
      pattern: /^\/admin\/colegios\/([^/]+)\/configurar$/,
      resolve: (m) => ({
        title: 'Configurar año académico',
        parent: { href: ROUTES.adminColegio(m[1]!), label: 'Colegio' },
      }),
    },
    {
      pattern: /^\/admin\/colegios\/[^/]+(\/.*)?$/,
      resolve: () => ({
        title: 'Colegio',
        parent: { href: ROUTES.adminColegios, label: 'Colegios' },
      }),
    },
    {
      pattern: /^\/admin\/instrumentos\/([^/]+)\/spec-table$/,
      resolve: (m) => ({
        title: 'Tabla de especificaciones',
        parent: { href: ROUTES.adminInstrumento(m[1]!), label: 'Instrumento' },
      }),
    },
    {
      pattern: /^\/admin\/instrumentos\/[^/]+$/,
      resolve: () => ({
        title: 'Instrumento',
        parent: { href: ROUTES.adminInstrumentos, label: 'Instrumentos oficiales' },
      }),
    },
    {
      pattern: /^\/admin\/instrumentos-bandas\/[^/]+$/,
      resolve: () => ({
        title: 'Niveles de logro',
        parent: { href: ROUTES.adminInstrumentosBandas, label: 'Niveles de logro por instrumento' },
      }),
    },
  ];

/** Título de la vista para un pathname; `null` si la ruta no está mapeada. */
export function resolvePageTitle(pathname: string): PageTitle | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;

  const exact = STATIC_TITLES[path];
  if (exact) return exact;

  for (const { pattern, resolve } of DYNAMIC_TITLES) {
    const match = path.match(pattern);
    if (match) return resolve(match);
  }

  return null;
}
