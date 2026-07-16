import { Module } from '@nestjs/common';
import { OfficialReportImportController } from './official-report-import.controller';
import { OfficialReportImportService } from './official-report-import.service';
import { OfficialReportPreviewStore } from './lib/preview-store';

/**
 * Importador de informes oficiales de resultados (Fase 4 del plan de analítica
 * agregada). Separado de `DiaIngestionModule` — ese importa bancos de preguntas
 * (instruments + items + tags); éste importa RESULTADOS agregados por curso.
 */
@Module({
  controllers: [OfficialReportImportController],
  providers: [OfficialReportImportService, OfficialReportPreviewStore],
  exports: [OfficialReportImportService],
})
export class OfficialReportImportModule {}
