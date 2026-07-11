import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { InstrumentsController } from './instruments.controller';
import { InstrumentsService } from './instruments.service';

@Module({
  // El PDF del enunciado (TKT-15) se almacena vía el módulo genérico `files`.
  imports: [FilesModule],
  controllers: [InstrumentsController],
  providers: [InstrumentsService],
  exports: [InstrumentsService],
})
export class InstrumentsModule {}
