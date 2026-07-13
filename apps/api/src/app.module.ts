import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { AuthGuard } from './auth/auth.guard';
import { PrivacyModule } from './privacy/privacy.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { TaxonomiesModule } from './taxonomies/taxonomies.module';
import { AdminModule } from './admin/admin.module';
import { StaffModule } from './staff/staff.module';
import { TeacherAssignmentsModule } from './teacher-assignments/teacher-assignments.module';
import { ClassGroupsModule } from './class-groups/class-groups.module';
import { StudentsModule } from './students/students.module';
import { InstrumentsModule } from './instruments/instruments.module';
import { FilesModule } from './files/files.module';
import { ItemsModule } from './items/items.module';
import { ItemEditProposalsModule } from './item-edit-proposals/item-edit-proposals.module';
import { DiaIngestionModule } from './dia-ingestion/dia-ingestion.module';
import { AiTaggingModule } from './ai-tagging/ai-tagging.module';
import { SpecTablesModule } from './spec-tables/spec-tables.module';
import { CatalogModule } from './catalog/catalog.module';
import { AnswerSheetsModule } from './answer-sheets/answer-sheets.module';
import { GradingScalesModule } from './grading-scales/grading-scales.module';
import { AssessmentResultsModule } from './assessment-results/assessment-results.module';
import { PerformanceBandsModule } from './performance-bands/performance-bands.module';
import { DashboardsModule } from './dashboards/dashboards.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { HeatmapModule } from './heatmap/heatmap.module';
import { ItemAnalysisModule } from './item-analysis/item-analysis.module';
import { AssessmentReportModule } from './assessment-report/assessment-report.module';
import { JobsModule } from './jobs/jobs.module';
import { CurriculumRetrieverModule } from './curriculum-retriever/curriculum-retriever.module';
import { AiAnalysisModule } from './ai-analysis/ai-analysis.module';
import { BenchmarkSettingsModule } from './benchmark-settings/benchmark-settings.module';
import { RemedialModule } from './remedial/remedial.module';
import { BenchmarkingModule } from './benchmarking/benchmarking.module';
import { InstrumentQualityModule } from './instrument-quality/instrument-quality.module';
import { AiObservabilityModule } from './ai-observability/ai-observability.module';
import { AssistantModule } from './assistant/assistant.module';
import { OfficialReportsModule } from './official-reports/official-reports.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
    }),
    DatabaseModule,
    HealthModule,
    AuthModule,
    PrivacyModule,
    OrganizationsModule,
    TaxonomiesModule,
    AdminModule,
    StaffModule,
    TeacherAssignmentsModule,
    ClassGroupsModule,
    StudentsModule,
    InstrumentsModule,
    // ── Módulo genérico de almacenamiento de archivos (S3 CRUD reutilizable) ──
    FilesModule,
    ItemsModule,
    // ── TKT-19: escritura asistida de ítems (IA propone, humano aprueba) ──
    ItemEditProposalsModule,
    DiaIngestionModule,
    AiTaggingModule,
    SpecTablesModule,
    CatalogModule,
    // ── Sprint 3: hojas de respuesta, resultados y escalas de notas ──
    AnswerSheetsModule,
    GradingScalesModule,
    AssessmentResultsModule,
    PerformanceBandsModule,
    // ── Sprint 4: dashboards core y analítica de series temporales ──
    DashboardsModule,
    AnalyticsModule,
    // ── Sprint 5: dashboards avanzados (heatmap, tabla cruzada, distractores) ──
    HeatmapModule,
    ItemAnalysisModule,
    // ── Informe consolidado por evaluación (directivos / UTP) ──
    AssessmentReportModule,
    // ── F2 S0: cimientos (jobs async in-process, recuperación curricular, motor IA, benchmarking) ──
    JobsModule,
    CurriculumRetrieverModule,
    AiAnalysisModule,
    BenchmarkSettingsModule,
    // ── F2 S2: análisis IA por-pregunta (en AiAnalysisModule) + calidad de instrumento ──
    InstrumentQualityModule,
    // ── F2 S3: IA Remedial (RAG) — generación de material con aprobación humana ──
    RemedialModule,
    // ── F2 S4: Benchmarking Institucional (read-model cross-tenant + k-anonimato) ──
    BenchmarkingModule,
    // ── F2 S5: observabilidad de costo/latencia IA (H19.25) ──
    AiObservabilityModule,
    // ── E21: Asistente IA Conversacional (loop de tool-use + chat SSE) ──
    AssistantModule,
    // ── Informes oficiales (TKT-24/25/26): por curso, establecimiento y por alumno ──
    OfficialReportsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      // AuthGuard aplicado globalmente: toda ruta requiere JWT salvo @Public().
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
  ],
})
export class AppModule {}
