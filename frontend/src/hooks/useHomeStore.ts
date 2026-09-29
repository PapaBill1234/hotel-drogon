import { useQuery } from '@tanstack/react-query';

import {
  fetchHomeStoreCategories,
  fetchHomeStoreItems,
} from '../services/apiHomesStore';
import type { HomeStoreType } from '../types/homes';

export const homeStoreKeys = {
  categories: (type: HomeStoreType) => ['home-store-categories', type] as const,
  items: (type: HomeStoreType, categoryId: number) =>
    ['home-store-items', type, categoryId] as const,
};

/** Signed-in, read-only category metadata. */
export function useHomeStoreCategories(type: HomeStoreType) {
  return useQuery({
    queryKey: homeStoreKeys.categories(type),
    queryFn: ({ signal }) => fetchHomeStoreCategories(type, signal),
    retry: false,
    staleTime: 30_000,
  });
}

/** Signed-in, read-only item metadata for one selected category. */
export function useHomeStoreItems(
  type: HomeStoreType,
  categoryId: number | null,
) {
  return useQuery({
    queryKey: homeStoreKeys.items(type, categoryId ?? 0),
    queryFn: ({ signal }) => fetchHomeStoreItems(type, categoryId as number, signal),
    enabled: categoryId !== null,
    retry: false,
    staleTime: 30_000,
  });
}
