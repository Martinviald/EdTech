import { cache } from 'react';

import { apiGet } from '@/lib/api';
import type { InstrumentModel, ItemModel, TaxonomyNodeModel } from '@soe/types';
import type { CatalogEntry } from './ItemBankFilters';

export type ItemsListResponse = {
  data: ItemModel[];
  total: number;
  page: number;
  limit: number;
};

export type InstrumentsListResponse = {
  data: InstrumentModel[];
  total: number;
  page: number;
  limit: number;
};

const CURRICULUM_MARCO_TYPE = 'mineduc';

export const getCatalogSubjects = cache(() => apiGet<CatalogEntry[]>('/catalog/subjects'));

export const getCatalogGrades = cache(() => apiGet<CatalogEntry[]>('/catalog/grades'));

export const getCurriculumNodes = cache(() =>
  apiGet<TaxonomyNodeModel[]>(`/taxonomies/nodes/facets?taxonomyType=${CURRICULUM_MARCO_TYPE}`),
);

export const getItems = cache((query: string) =>
  apiGet<ItemsListResponse>(`/items?${query}`),
);

export const getInstruments = cache(() =>
  apiGet<InstrumentsListResponse>('/instruments?limit=200'),
);
