import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';

import LandingPage from './pages/LandingPage';
import CommunityPage from './pages/CommunityPage';
import ArticlesPage from './pages/ArticlesPage';
import HelpPage from './pages/HelpPage';
import CollectablesPage from './pages/CollectablesPage';
import MaintenancePage from './pages/MaintenancePage';
import AdminLayout from './pages/admin/AdminLayout';
import AdminHomePage from './pages/admin/AdminHomePage';
import AdminNewsPage from './pages/admin/AdminNewsPage';
import AdminFaqPage from './pages/admin/AdminFaqPage';
import AdminBannersPage from './pages/admin/AdminBannersPage';
import AdminCampaignsPage from './pages/admin/AdminCampaignsPage';
import AdminCollectiblesPage from './pages/admin/AdminCollectiblesPage';
import AdminSettingsPage from './pages/admin/AdminSettingsPage';
import HousekeepingLoginPage from './pages/admin/HousekeepingLoginPage';
import LoginPage from './pages/account/LoginPage';
import LogoutPage from './pages/account/LogoutPage';
import MePage from './pages/account/MePage';
import ProfilePage from './pages/account/ProfilePage';
import WalletPage from './pages/account/WalletPage';
import TransactionHistoryPage from './pages/account/TransactionHistoryPage';

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
  // credits.php and history.php both set $page['bodyid'] = 'home' and require
  // community_header.php. credits.php allows guests; history.php does not, and
  // the class is empty either way once a user is signed in.
  '/credits': { id: 'home', className: '' },
  '/credits/history': { id: 'home', className: '' },
  // me.php and profile.php both set $page['bodyid'] = 'home' and require
  // community_header.php, which adds class="anonymous" only for a guest — these
  // two routes are guest-refused, so the class is empty.
  //
  // The styling for both lives in v2/styles/personal.css (#new-personal-info,
  // #link-bar), which the community stylesheet set already contains.
  '/me': { id: 'home', className: '' },
  '/account/profile': { id: 'home', className: '' },
  // account.php rendered the sign-in screen with the community header too.
  '/account': { id: 'home', className: '' },
  '/logout': { id: 'home', className: '' },
};

function LegacyBodyAttributes() {
  const { pathname } = useLocation();

  useEffect(() => {
    // Article detail URLs are /articles/<id>-<slug>; they share the list page's
    // body attributes. Housekeeping has no entry in BODY_BY_PATH on purpose:
    // templates/housekeeping_header.php emits a plain <body> with no id and no
    // class, and the admin panel carries its own scoped stylesheet, so the
    // fallback below (empty id and class) is the accurate value.
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
 *
 * `/housekeeping/*` replaces the legacy `housekeeping/*.php` entry points. It
 * keeps the legacy URL shape so links and bookmarks survive the conversion; the
 * pages themselves are React components calling `/api/admin/*`, and the panel
 * gates itself on the separate staff session (see `pages/admin/AdminLayout`).
 * `*.php` suffixes are also accepted because the legacy URLs were written
 * without `.htaccess` rewriting, e.g. `/housekeeping/news.php`.
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

        {/* Account surface. `/account` is the sign-in destination the anonymous
            header form posts to, matching the legacy `account.php` entry point;
            `/me` and `/account/profile` are `me.php` and `profile.php`. */}
        <Route path="/account" element={<LoginPage />} />
        <Route path="/logout" element={<LogoutPage />} />
        <Route path="/me" element={<MePage />} />
        <Route path="/account/profile" element={<ProfilePage />} />
        {/* credits.php and history.php. The legacy transactions link was
            `/credits/history`, so that path is kept verbatim. */}
        <Route path="/credits" element={<WalletPage />} />
        <Route path="/credits/history" element={<TransactionHistoryPage />} />

        <Route path="/housekeeping" element={<AdminLayout />}>
          <Route index element={<AdminHomePage />} />
          <Route path="news" element={<AdminNewsPage />} />
          <Route path="faq" element={<AdminFaqPage />} />
          <Route path="banners" element={<AdminBannersPage />} />
          <Route path="campaigns" element={<AdminCampaignsPage />} />
          <Route path="collectables" element={<AdminCollectiblesPage />} />
          <Route path="settings" element={<AdminSettingsPage />} />
        </Route>
        {/* The login screen is outside AdminLayout: the layout exists to gate on
            a staff session, and the login screen is how one is obtained. */}
        <Route path="/housekeeping/login" element={<HousekeepingLoginPage />} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
