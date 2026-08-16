import { Module } from '@nestjs/common';
import { DashboardsModule } from '../dashboards/dashboards.module';
import { StudentsController } from './students.controller';
import { StudentsImportService } from './students-import.service';
import { StudentPanoramaController } from './student-panorama.controller';
import { StudentPanoramaService } from './student-panorama.service';
import { StudentComparisonsController } from './student-comparisons.controller';
import { StudentComparisonsService } from './student-comparisons.service';
import { StudentSignalsController } from './student-signals.controller';
import { StudentSignalsService } from './student-signals.service';

@Module({
  imports: [DashboardsModule],
  controllers: [
    StudentsController,
    StudentPanoramaController,
    StudentComparisonsController,
    StudentSignalsController,
  ],
  providers: [
    StudentsImportService,
    StudentPanoramaService,
    StudentComparisonsService,
    StudentSignalsService,
  ],
  exports: [StudentsImportService],
})
export class StudentsModule {}
