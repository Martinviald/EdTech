import { Module } from '@nestjs/common';
import { TaxonomiesController } from './taxonomies.controller';
import { TaxonomiesService } from './taxonomies.service';
import { NodesController } from './nodes.controller';
import { NodesService } from './nodes.service';

@Module({
  // NodesController va PRIMERO: su ruta estática `taxonomies/nodes` debe
  // registrarse antes que la paramétrica `taxonomies/:id` de TaxonomiesController,
  // o `GET /taxonomies/nodes` sería capturado por `:id` (id="nodes").
  controllers: [NodesController, TaxonomiesController],
  providers: [TaxonomiesService, NodesService],
  exports: [TaxonomiesService, NodesService],
})
export class TaxonomiesModule {}
