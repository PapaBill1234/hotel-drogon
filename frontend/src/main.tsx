import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';

import App from './App';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // The legacy pages re-fetched on every navigation; a short stale time
      // keeps the SPA feeling identical without hammering the API.
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root container #root was not found in index.html');
}

/**
 * Remove Prototype's `toJSON` patches before anything serializes JSON.
 *
 * `index.html` loads the legacy `web-gallery/static/js/libs.js`, which is
 * Prototype 1.7 — and Prototype adds `toJSON` to `Array.prototype` and
 * `Object.prototype`. Native `JSON.stringify` calls `toJSON()` on any value that
 * has one, so `JSON.stringify({widgets: [row]})` produced
 *
 *   {"widgets":"[{\"id\": 0, \"column\": 2, \"position\": 1}]"}
 *
 * — the array as a **string**, in Prototype's own formatting. It was found on the
 * MyHabbo layout save, where the server correctly answered "widgets must be an
 * array." and the editor reported that verbatim. Every API call that sends an
 * array was affected; the others send objects and scalars and never showed it.
 *
 * Deleting the prototype methods restores the native semantics the API client
 * depends on. Prototype's own static `Object.toJSON` is untouched, so the legacy
 * scripts that call it explicitly keep working, and nothing in this SPA calls
 * `value.toJSON()` expecting Prototype's string.
 */
for (const proto of [Array.prototype, Object.prototype] as object[]) {
  if (Object.prototype.hasOwnProperty.call(proto, 'toJSON')) {
    delete (proto as { toJSON?: unknown }).toJSON;
  }
}

ReactDOM.createRoot(container).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
