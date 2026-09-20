import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';

import LandingPage from './pages/LandingPage';
import CommunityPage from './pages/CommunityPage';
import ArticlesPage from './pages/ArticlesPage';
import HelpPage from './pages/HelpPage';
import CollectablesPage from './pages/CollectablesPage';
import MaintenancePage from './pages/MaintenancePage';

/**
 * The legacy stylesheets target body-level selectors (`body#news #column1`,
 * `body.anonymous #header`, `body#frontpage ...`), and each legacy page sets
 * both the id and the class on <body> itself:
 *
 *   templates/community_header.php -> <body id="<?= $page['bodyid'] ?>"
 *                                            class="<?= guest ? 'anonymous' : '' ?>">
 *   templates/login_header.php     -> <body id="frontpage">   (new_landing, no class)
 *   templates/maintenance_header.php -> <body>                (no id, no class)
 *
 * Without this the imported CSS largely does not apply and the pages render
 * essentially unstyled, which is indistinguishable from "wrong markup" in a
 * screenshot diff. Values below are taken from each page's `$page['bodyid']`.
 */
const BODY_BY_PATH: Record<string, { id: string; className: string }> = {
  '/': { id: 'frontpage', className: '' }, // landing.php: bodyid=frontpage, new_landing=true
  '/community': { id: 'home', className: 'anonymous' }, // community.php
  '/articles': { id: 'news', className: 'anonymous' }, // articles.php
  '/help': { id: 'home', className: 'anonymous' }, // help.php
  '/credits/collectables': { id: 'home', className: 'anonymous' }, // collectables.php
  '/maintenance': { id: '', className: '' }, // maintenance_header.php: plain <body>
};

function LegacyBodyAttributes() {
  const { pathname } = useLocation();

  useEffect(() => {
    // Article detail URLs are /articles/<id>-<slug>; they share the list page's
    // body attributes.
    const key = pathname.startsWith('/articles/') ? '/articles' : pathname;
    const cfg = BODY_BY_PATH[key] ?? { id: '', className: '' };
    document.body.id = cfg.id;
    document.body.className = cfg.className;
  }, [pathname]);

  return null;
}

/**
 * Route table mirroring the legacy PHP entry points.
 *
 * `/articles` covers both URL shapes the legacy site produced: the query form
 * (`/articles?id=5`, `/articles?archive=true`, `/articles?category=X&pageNumber=N`)
 * and the slug form the frontpage promo linked to (`/articles/5-title-safe`).
 */
export default function App() {
  return (
    <>
      <LegacyBodyAttributes />
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
    </>
  );
}
