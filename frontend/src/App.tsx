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
 *   templates/login_header.php     -> <body id="<?= $page['bodyid'] ?>"
 *                                            class="<?= $page['new_landing'] != true ? 'process-template' : '' ?>">
 *   templates/maintenance_header.php -> <body>                (no id, no class)
 *
 * Without this the imported CSS largely does not apply and the pages render
 * essentially unstyled, which is indistinguishable from "wrong markup" in a
 * screenshot diff. Values below are taken from each page's `$page['bodyid']`.
 */
const BODY_BY_PATH: Record<string, { id: string; className: string }> = {
  // index.php: bodyid=landing. login_header.php adds class="process-template"
  // (it is skipped only on the `new_landing` frontpage), and every landing
  // layout rule in process.css is scoped to `body.process-template`:
  // #container 766px, #column1 404px, #column2 310px, #content padding.
  '/': { id: 'landing', className: 'process-template' },
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

  useEffect(() => {
    // The legacy templates call these after the DOM exists (see
    // templates/community_footer.php). They are loaded as classic scripts from
    // index.html, so they are defined by the time this effect runs.
    //
    // Rounder.init() is the important one for parity: it rewrites `.rounded`
    // elements into the nested .rounded-container gradient markup that the
    // legacy pages actually render. HabboView.run() flushes callbacks that
    // templates registered. Both are wrapped because a failure in legacy code
    // must not take the React tree down with it.
    const w = window as unknown as {
      Rounder?: { init?: () => void };
      HabboView?: { run?: () => void };
    };
    const timer = window.setTimeout(() => {
      try {
        w.Rounder?.init?.();
      } catch (err) {
        console.warn('Rounder.init() failed', err);
      }
      try {
        w.HabboView?.run?.();
      } catch (err) {
        console.warn('HabboView.run() failed', err);
      }
    }, 0);
    return () => window.clearTimeout(timer);
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
