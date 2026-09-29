/** Read-only client for the signed-in Homes Store catalogue metadata APIs. */

import { requestJson } from './api';
import type {
  HomeStoreCategoriesResponse,
  HomeStoreItemsResponse,
  HomeStoreType,
} from '../types/homes';

const STORE_BASE = '/api/homes/store';

export function fetchHomeStoreCategories(
  type: HomeStoreType,
  signal?: AbortSignal,
): Promise<HomeStoreCategoriesResponse> {
  return requestJson<HomeStoreCategoriesResponse>({
    method: 'GET',
    path: `${STORE_BASE}/categories?type=${encodeURIComponent(type)}`,
    csrf: false,
    signal,
  });
}

export function fetchHomeStoreItems(
  type: HomeStoreType,
  categoryId: number,
  signal?: AbortSignal,
): Promise<HomeStoreItemsResponse> {
  return requestJson<HomeStoreItemsResponse>({
    method: 'GET',
    path: `${STORE_BASE}/items?type=${encodeURIComponent(type)}&category_id=${encodeURIComponent(String(categoryId))}`,
    csrf: false,
    signal,
  });
}
