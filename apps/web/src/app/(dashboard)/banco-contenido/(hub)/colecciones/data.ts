import { cache } from 'react';

import { apiGet } from '@/lib/api';
import type { ItemCollectionListResponse } from '@soe/types';

export const getCollections = cache((query: string) =>
  apiGet<ItemCollectionListResponse>(`/item-collections?${query}`),
);
