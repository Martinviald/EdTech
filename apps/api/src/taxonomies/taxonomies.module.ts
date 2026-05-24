import { Module } from '@nestjs/common';
import { CurriculaController } from './curricula.controller';
import { CurriculaService } from './curricula.service';
import { NodesController } from './nodes.controller';
import { NodesService } from './nodes.service';

@Module({
  controllers: [CurriculaController, NodesController],
  providers: [CurriculaService, NodesService],
  exports: [CurriculaService, NodesService],
})
export class TaxonomiesModule {}
