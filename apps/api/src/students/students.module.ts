import { Module } from '@nestjs/common';
import { StudentsController } from './students.controller';
import { StudentsImportService } from './students-import.service';

@Module({
  controllers: [StudentsController],
  providers: [StudentsImportService],
  exports: [StudentsImportService],
})
export class StudentsModule {}
