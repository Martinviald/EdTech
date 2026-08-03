import { Module } from '@nestjs/common';
import { StudentsController } from './students.controller';
import { StudentsImportService } from './students-import.service';
import { StudentPanoramaController } from './student-panorama.controller';
import { StudentPanoramaService } from './student-panorama.service';

@Module({
  controllers: [StudentsController, StudentPanoramaController],
  providers: [StudentsImportService, StudentPanoramaService],
  exports: [StudentsImportService],
})
export class StudentsModule {}
