import { useEffect, useState } from 'react';

import { ApiRequestError } from '../services/api';
import { useHomeStoreCategories, useHomeStoreItems } from '../hooks/useHomeStore';
import type { HomeStoreItem, HomeStoreType } from '../types/homes';

const STORE_TYPES: Array<{ value: HomeStoreType; label: string }> = [
  { value: 'sticker', label: 'Stickers' },
  { value: 'background', label: 'Backgrounds' },
  { value: 'note', label: 'Notes' },
];

function errorMessage(error: unknown): string {
  return error instanceof ApiRequestError
    ? error.message
    : 'The Store catalogue could not be loaded.';
}

/**
 * The first read-only Homes Store slice.
 *
 * This deliberately renders catalogue text and opaque metadata only. It has no
 * purchase, preview, inventory, placement, credits or layout request path.
 */
export default function HomeStorePanel() {
  const [type, setType] = useState<HomeStoreType>('sticker');
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [selectedItem, setSelectedItem] = useState<HomeStoreItem | null>(null);
  const categories = useHomeStoreCategories(type);
  const categoryRows = categories.data?.categories ?? [];
  const items = useHomeStoreItems(type, categoryId);
  const itemRows = items.data?.items ?? [];

  useEffect(() => {
    setCategoryId(categoryRows[0]?.category_id ?? null);
    setSelectedItem(null);
  }, [type, categoryRows]);

  useEffect(() => {
    setSelectedItem(null);
  }, [categoryId]);

  return (
    <section className="home-store-panel" data-testid="home-store-panel">
      <h3>Homes Store</h3>
      <p>Select a category to browse available item metadata. Purchases and placement are not available here.</p>
      <label>
        Type{' '}
        <select
          value={type}
          onChange={(event) => setType(event.target.value as HomeStoreType)}
          data-testid="home-store-type"
        >
          {STORE_TYPES.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>

      {categories.isLoading ? <p data-testid="home-store-categories-loading">Loading categories…</p> : null}
      {categories.isError ? <p role="alert" data-testid="home-store-categories-error">{errorMessage(categories.error)}</p> : null}
      {!categories.isLoading && !categories.isError && categoryRows.length === 0 ? (
        <p data-testid="home-store-categories-empty">No categories are available.</p>
      ) : null}
      {categoryRows.length > 0 ? (
        <ul className="home-store-categories" data-testid="home-store-categories">
          {categoryRows.map((category) => (
            <li key={category.category_id}>
              <button
                type="button"
                className="new-button"
                aria-pressed={category.category_id === categoryId}
                onClick={() => setCategoryId(category.category_id)}
              >
                {category.category}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {items.isLoading ? <p data-testid="home-store-items-loading">Loading items…</p> : null}
      {items.isError ? <p role="alert" data-testid="home-store-items-error">{errorMessage(items.error)}</p> : null}
      {!items.isLoading && !items.isError && categoryId !== null && itemRows.length === 0 ? (
        <p data-testid="home-store-items-empty">No items are available in this category.</p>
      ) : null}
      {itemRows.length > 0 ? (
        <ul className="home-store-items" data-testid="home-store-items">
          {itemRows.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="new-button"
                aria-pressed={selectedItem?.id === item.id}
                onClick={() => setSelectedItem(item)}
              >
                {item.name}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {selectedItem ? (
        <div className="home-store-item-details" data-testid="home-store-item-details">
          <h4>{selectedItem.name}</h4>
          <p>{selectedItem.description}</p>
          <dl>
            <dt>Type</dt><dd>{selectedItem.type}</dd>
            <dt>Price</dt><dd>{selectedItem.price}</dd>
            <dt>Available amount</dt><dd>{selectedItem.amount}</dd>
            <dt>Placement</dt><dd>{selectedItem.placement}</dd>
            {selectedItem.data_key ? <><dt>Catalogue key</dt><dd>{selectedItem.data_key}</dd></> : null}
          </dl>
        </div>
      ) : null}
    </section>
  );
}
