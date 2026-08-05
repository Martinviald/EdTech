import type { Route } from 'next';

const route = (path: string): Route => path as Route;

/**
 * Fuente de verdad de las rutas de navegación de la app (Next App Router).
 * Solo rutas de UI: `Link href`, `redirect()`, `router.push/replace`. NO incluye
 * endpoints del backend (`apiGet('/organizations/me')`) — esos son paths de API,
 * no rutas de Next, y viven en las llamadas `api*`.
 *
 * Estáticas: valores `Route`. Dinámicas: funciones que reciben los parámetros y
 * devuelven `Route`. Los query strings se anexan en el call site
 * (`\`${ROUTES.resultados}?${qs}\``) porque dependen de datos.
 */
export const ROUTES = {
  home: route('/'),
  login: route('/login'),
  authError: route('/auth/error'),
  selectOrg: route('/seleccionar-colegio'),
  styleguide: route('/styleguide'),

  dashboard: route('/dashboard'),
  myClasses: route('/dashboard/my-classes'),
  myClass: (classGroupId: string) => route(`/dashboard/my-classes/${classGroupId}`),

  evaluaciones: route('/evaluaciones'),
  evaluacion: (assessmentId: string) => route(`/evaluaciones/${assessmentId}`),
  evaluacionResultados: (assessmentId: string) => route(`/evaluaciones/${assessmentId}/resultados`),
  evaluacionDetalle: (assessmentId: string) => route(`/evaluaciones/${assessmentId}/detalle`),
  evaluacionAnalisisIa: (assessmentId: string) =>
    route(`/evaluaciones/${assessmentId}/analisis-ia`),
  evaluacionMaterialRemedial: (assessmentId: string) =>
    route(`/evaluaciones/${assessmentId}/material-remedial`),
  evaluacionInformeOficial: (assessmentId: string) =>
    route(`/evaluaciones/${assessmentId}/informe-oficial`),
  evaluacionInformeAlumno: (assessmentId: string, studentId: string) =>
    route(`/evaluaciones/${assessmentId}/informe-alumno/${studentId}`),
  evaluacionInformeAlumnoBase: (assessmentId: string) =>
    route(`/evaluaciones/${assessmentId}/informe-alumno`),

  estudiantes: route('/estudiantes'),
  estudiante: (studentId: string) => route(`/estudiantes/${studentId}`),

  resultados: route('/resultados'),
  resultadosClasificacion: route('/resultados/clasificacion'),
  resultadosComparacion: route('/resultados/comparacion'),
  resultadosDetalle: route('/resultados/detalle'),
  resultadosDimensiones: route('/resultados/dimensiones'),
  resultadosInforme: route('/resultados/informe'),
  resultadosMapaCalor: route('/resultados/mapa-calor'),
  resultadosProgresion: route('/resultados/progresion'),

  importar: route('/importar'),
  importarAlumnos: route('/importar/alumnos'),
  importarInstrumento: route('/importar/instrumento'),
  importarResultados: route('/importar/resultados'),
  importarResultadosCargar: route('/importar/resultados/cargar'),
  importarResultadosPreview: route('/importar/resultados/preview'),
  importarResultadosJob: (jobId: string) => route(`/importar/resultados/jobs/${jobId}`),
  importarDia: route('/importar-dia'),
  importarResultadosLegacy: route('/importar-resultados'),

  bancoItems: route('/banco-contenido'),
  bancoItemsExplorar: route('/banco-contenido/explorar'),
  bancoItemsNuevo: route('/banco-contenido/nuevo'),
  bancoColecciones: route('/banco-contenido/colecciones'),
  bancoColeccion: (collectionId: string) => route(`/banco-contenido/colecciones/${collectionId}`),
  bancoItem: (instrumentId: string) => route(`/banco-contenido/${instrumentId}`),
  bancoItemEtiquetar: (instrumentId: string) => route(`/banco-contenido/${instrumentId}/etiquetar`),
  bancoItemSpecTable: (instrumentId: string) =>
    route(`/banco-contenido/${instrumentId}/spec-table`),
  bancoItemSpecTableCargar: (instrumentId: string) =>
    route(`/banco-contenido/${instrumentId}/spec-table/cargar`),

  organizacion: route('/organizacion'),
  organizacionAsignaciones: route('/organizacion/asignaciones'),
  organizacionConfigurar: route('/organizacion/configurar'),

  configuracion: route('/configuracion'),
  configEscalas: route('/configuracion/escalas'),
  configEscalasNueva: route('/configuracion/escalas/nueva'),
  configEscala: (id: string) => route(`/configuracion/escalas/${id}`),
  configModelosIa: route('/configuracion/modelos-ia'),
  configObservabilidadIa: route('/configuracion/observabilidad-ia'),

  administracion: route('/administracion'),
  analisisIa: route('/analisis-ia'),
  benchmarking: route('/benchmarking'),
  compararInstrumentos: route('/comparar-instrumentos'),
  equipo: route('/equipo'),
  alumnos: route('/alumnos'),
  instrumentoEnunciado: (instrumentId: string) => route(`/instrumentos/${instrumentId}/enunciado`),
  marcosAcademicos: route('/marcos-academicos'),
  marcoAcademico: (taxonomyId: string) => route(`/marcos-academicos/${taxonomyId}`),
  materialRemedial: route('/material-remedial'),
  materialRemedialDetalle: (id: string) => route(`/material-remedial/${id}`),
  establecimientoInformeOficial: route('/establecimiento/informe-oficial'),

  admin: route('/admin'),
  adminColegios: route('/admin/colegios'),
  adminColegio: (id: string) => route(`/admin/colegios/${id}`),
  adminColegioConfigurar: (id: string) => route(`/admin/colegios/${id}/configurar`),
  adminColegioAsignaturas: (id: string) => route(`/admin/colegios/${id}/asignaturas`),
  adminColegioCursos: (id: string) => route(`/admin/colegios/${id}/cursos`),
  adminColegioMiembros: (id: string) => route(`/admin/colegios/${id}/miembros`),
  adminEquipo: route('/admin/equipo'),
  adminInstrumentos: route('/admin/instrumentos'),
  adminInstrumento: (instrumentId: string) => route(`/admin/instrumentos/${instrumentId}`),
  adminInstrumentoSpecTable: (instrumentId: string) =>
    route(`/admin/instrumentos/${instrumentId}/spec-table`),
  adminInstrumentosBandas: route('/admin/instrumentos-bandas'),
  adminInstrumentoBandas: (instrumentId: string) =>
    route(`/admin/instrumentos-bandas/${instrumentId}`),
  adminModelosIa: route('/admin/modelos-ia'),
} as const;
