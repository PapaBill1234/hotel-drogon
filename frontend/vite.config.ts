import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The legacy PHP pages were served from the same origin as /api and
// /articles (including /articles/rss.xml). The dev server proxies both
// prefixes to the C++ Drogon backend so the ported pages keep resolving
// their data with no client-side URL rewriting.
const BACKEND_ORIGIN = 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: BACKEND_ORIGIN,
        changeOrigin: true,
      },
      '/articles': {
        target: BACKEND_ORIGIN,
        changeOrigin: true,
      },
    },
  },
});
