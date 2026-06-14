import { Module } from '@nestjs/common';
import { AssessmentReportModule } from '../assessment-report/assessment-report.module';
import { InstrumentQualityController } from './instrument-quality.controller';
import { InstrumentQualityService } from './instrument-quality.service';

/**
 * H20.9 — Calidad de instrumento e ítems (DETERMINISTA, sin IA).
 *
 * Reusa AssessmentReportService (psicometría p/D/distractor) vía
 * AssessmentReportModule. La conexión a BD la provee el DatabaseModule global.
 * NO se registra aquí en app.module (lo hace integración).
 */
@Module({
  imports: [AssessmentReportModule],
  controllers: [InstrumentQualityController],
  providers: [InstrumentQualityService],
  exports: [InstrumentQualityService],
})
export class InstrumentQualityModule {}
