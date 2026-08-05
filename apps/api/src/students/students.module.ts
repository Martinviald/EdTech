import { Module } from '@nestjs/common';
import { StudentsController } from './students.controller';
import { StudentsImportService } from './students-import.service';
import { StudentPanoramaController } from './student-panorama.controller';
import { StudentPanoramaService } from './student-panorama.service';
import { StudentSignalsController } from './student-signals.controller';
import { StudentSignalsService } from './student-signals.service';

@Module({
  controllers: [StudentsController, StudentPanoramaController, StudentSignalsController],
  providers: [StudentsImportService, StudentPanoramaService, StudentSignalsService],
  exports: [StudentsImportService],
})
export class StudentsModule {}
