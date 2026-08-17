import { Injectable } from '@nestjs/common';
import { ITEM_VIEWER_ROLES } from '@soe/types';
import { TaxonomiesService } from '../../taxonomies/taxonomies.service';
import type { AnalyticsPrincipal } from '../core/analytics-principal';
import {
  McpResourceProvider,
  type McpResource,
  type ResourceDescriptor,
} from '../core/mcp-resource';

@McpResourceProvider()
@Injectable()
export class TaxonomyResource implements McpResource {
  readonly descriptor: ResourceDescriptor = {
    scheme: 'taxonomy',
    uriTemplate: 'taxonomy://{taxonomyId}',
    name: 'Árbol de taxonomía',
    description:
      'Árbol de habilidades/ejes de un currículo (taxonomy_nodes). Úsalo para ubicar una brecha o ' +
      'una habilidad medida por un ítem dentro de la jerarquía curricular.',
    mimeType: 'application/json',
    requiredRoles: ITEM_VIEWER_ROLES,
  };

  constructor(private readonly taxonomies: TaxonomiesService) {}

  read(principal: AnalyticsPrincipal, taxonomyId: string): Promise<unknown> {
    return this.taxonomies.getTree(taxonomyId, principal);
  }
}
