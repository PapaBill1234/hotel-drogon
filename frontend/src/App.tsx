import { Navigate, Route, Routes } from 'react-router-dom';

import LandingPage from './pages/LandingPage';
import CommunityPage from './pages/CommunityPage';
import ArticlesPage from './pages/ArticlesPage';
import HelpPage from './pages/HelpPage';
import CollectablesPage from './pages/CollectablesPage';
import MaintenancePage from './pages/MaintenancePage';

/**
 * Route table mirroring the legacy PHP entry points.
 *
 * `/articles` covers both URL shapes the legacy site produced: the query form
 * (`/articles?id=5`, `/articles?archive=true`, `/articles?category=X&pageNumber=N`)
 * and the slug form the frontpage promo linked to (`/articles/5-title-safe`).
 */
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/community" element={<CommunityPage />} />
      <Route path="/articles" element={<ArticlesPage />} />
      <Route path="/articles/:id" element={<ArticlesPage />} />
      <Route path="/help" element={<HelpPage />} />
      <Route path="/credits/collectables" element={<CollectablesPage />} />
      <Route path="/maintenance" element={<MaintenancePage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
