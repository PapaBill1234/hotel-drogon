import { useEffect } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';

import LandingPage from './pages/LandingPage';
import NotFoundPage from './pages/NotFoundPage';
import NotYetAvailablePage from './pages/NotYetAvailablePage';
import PapersPage from './pages/PapersPage';
import TagPage from './pages/TagPage';
import { disableLegacyRounder } from './components/Rounder';
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
import ClientPage from './pages/account/ClientPage';
import ForgotPasswordPage, { ResetPasswordPage } from './pages/account/ForgotPasswordPage';
import ReauthenticatePage from './pages/account/ReauthenticatePage';

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
  // client.php emitted its own page shell (templates/client_header.php) with
  // <body id="client" class="wide">. The converted page reuses the community
  // shell instead, because the Shockwave document the legacy body was built
  // around no longer exists; the id below keeps the legacy client body id so any
  // `#client` rule still resolves.
  '/client': { id: 'client', className: 'wide' },
  // forgot.php and reauthenticate.php both used templates/login_header.php with
  // $page['bodyid'] = "" / "reauthenticate". Both get class="process-template":
  // login_header.php adds it for every page whose `new_landing` is not true, and
  // process.css scopes the whole centred-panel layout to `body.process-template`.
  // The recovery routes previously set an EMPTY class, so they rendered as a
  // full-width unstyled community page instead of the centred panel — measured
  // at 86% of the frame differing on /forgot, the worst page in the audit.
  '/forgot': { id: '', className: 'process-template' },
  '/account/password/forgot': { id: '', className: 'process-template' },
  '/account/password/reset': { id: '', className: 'process-template' },
  '/account/reauthenticate': { id: 'reauthenticate', className: 'process-template' },
  // me.php and profile.php both set $page['bodyid'] = 'home' and require
  // community_header.php, which adds class="anonymous" only for a guest — these
  // two routes are guest-refused, so the class is empty.
  //
  // The styling for both lives in v2/styles/personal.css (#new-personal-info,
  // #link-bar), which the community stylesheet set already contains.
  '/me': { id: 'home', className: '' },
  '/account/profile': { id: 'home', className: '' },
  // account.php set `$page['bodyid'] = "landing"` and rendered through
  // templates/login_header.php, i.e. `body#landing.process-template`. It never
  // rendered a sign-in box itself — its login case is a POST handler, and a GET
  // falls through to the 404 default — so `/account` is a port convenience. It
  // gets the landing process-template body so `ProcessShell` lays out the same
  // way the legacy sign-in form does on `/`.
  '/account': { id: 'landing', className: 'process-template' },
  '/logout': { id: 'home', className: '' },
  // `account/logout.php` — the signed-in header's Sign Out target. It renders
  // through the community shell like `/logout`.
  '/account/logout': { id: 'home', className: '' },
  // tag.php: `$page['bodyid'] = 'tags'`, `$page['cat'] = 'community'`, guests
  // allowed. The id matters beyond styling: the navi2 strip keys its selected
  // "Tags" tab on it.
  '/tag': { id: 'tags', className: 'anonymous' },
  // papers.php: `$page['bodyid'] = 'landing'` through login_header.php, so the
  // same `body#landing.process-template` as the recovery pages. Without these
  // two entries the Disclaimer and Privacy Policy pages — which are in the
  // footer of EVERY page — rendered with no process-template layout at all.
  '/papers/disclaimer': { id: 'landing', className: 'process-template' },
  '/papers/privacy': { id: 'landing', className: 'process-template' },
  // club.php and pixels.php: both `bodyid = "home"`, `cat = "credits"`, both
  // `allow_guests = true`, both rendered through community_header.php.
  '/credits/club': { id: 'home', className: 'anonymous' },
  '/credits/pixels': { id: 'home', className: 'anonymous' },
  // register.php is a FOURTH body variant: templates/register_header.php:157 is
  // the only template that emits both a non-empty id and an extra class —
  // `<body id="register" class="process-template secure-page">`. `secure-page`
  // is what makes `process.css:27` size the header logo to 42px.
  '/register': { id: 'register', className: 'process-template secure-page' },
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
    // `HabboView.run()` flushes the callbacks the legacy templates registered
    // (see templates/community_footer.php). It is wrapped because a failure in
    // legacy code must not take the React tree down with it.
    //
    // `Rounder.init()` used to be called here as well, for visual parity. It is
    // gone on purpose; see `disableLegacyRounder()` below and
    // `components/Rounder.tsx`.
    const w = window as unknown as {
      HabboView?: { run?: () => void };
    };
    const timer = window.setTimeout(() => {
      // The legacy `Rounder` must never run against React's DOM: `addCorners`
      // does `N.cloneNode(true)` + `parentNode.replaceChild(...)`, which throws
      // React's node away, so every later React update is written to a detached
      // node and silently disappears. That single legacy operation is why
      // `/forgot` rendered "Forgotten Your  Name?" on a page whose settings had
      // resolved to "Retro", and it orphaned 106 of 167 React nodes there and
      // 183 of 316 on `/credits/collectables`.
      //
      // Its markup is reproduced in React instead — see `components/Rounder.tsx`
      // — and this call stops the legacy copy. It has to happen before
      // `HabboView.run()` because `visual.js:228` registers a SECOND
      // `Rounder.init()` through `HabboView.add`, so merely not calling it
      // ourselves leaves it running.
      disableLegacyRounder();
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
        {/*
          Every page footer links its FAQ entries as `/help/<id>`
          (`login_footer.php`/`community_footer.php` build
          `PATH.'/help/'.(int) $row['id']`), and the site's own tests use those
          URLs. Legacy `help.php` ignored the segment and rendered the whole help
          page, so this does the same rather than 404ing on a link the footer puts
          on every page.
        */}
        <Route path="/help/:id" element={<HelpPage />} />
        <Route path="/credits/collectables" element={<CollectablesPage />} />
        <Route path="/maintenance" element={<MaintenancePage />} />

        {/* Account surface. `/account` is the sign-in destination the anonymous
            header form posts to, matching the legacy `account.php` entry point;
            `/me` and `/account/profile` are `me.php` and `profile.php`. */}
        <Route path="/account" element={<LoginPage />} />
        <Route path="/logout" element={<LogoutPage />} />
        {/*
          `community_header.php:250` links the signed-in header's "Sign Out" at
          `/account/logout`, not `/logout`. Both are routed so the legacy URL the
          header itself writes is not a dead link, the same way `/forgot` and
          `/account/password/forgot` both are.
        */}
        <Route path="/account/logout" element={<LogoutPage />} />
        <Route path="/me" element={<MePage />} />
        <Route path="/account/profile" element={<ProfilePage />} />
        {/* credits.php and history.php. The legacy transactions link was
            `/credits/history`, so that path is kept verbatim. */}
        <Route path="/credits" element={<WalletPage />} />
        <Route path="/credits/history" element={<TransactionHistoryPage />} />
        {/* client.php. Before this route existed, every "Enter PHPRetro" link on
            the site fell through to the catch-all and quietly redirected to the
            front page — a dead entrance rather than an honest one. */}
        <Route path="/client" element={<ClientPage />} />
        {/* forgot.php kept two URL shapes in the legacy site: the page answered
            at `/forgot` but the header linked to `/account/password/forgot`.
            Both are routed so neither link is dead. */}
        <Route path="/forgot" element={<ForgotPasswordPage />} />
        <Route path="/account/password/forgot" element={<ForgotPasswordPage />} />
        <Route path="/account/password/reset" element={<ResetPasswordPage />} />
        {/* reauthenticate.php. The address the legacy client redirected to was
            `/account/reauthenticate`. */}
        <Route path="/account/reauthenticate" element={<ReauthenticatePage />} />

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

        {/*
          Routes the legacy site has and this stack does not have a real page
          for — yet.

          Without these the catch-all below sent every one of them to "/", so a
          click looked like the site had thrown the visitor back to the front
          page for no reason. `/credits/club` and `/credits/pixels` are in the
          signed-in header and the /me link bar, so this was easy to hit.

          Each states what is missing and which phase delivers it, which is the
          honest version of "not converted" and matches the plan's rule against
          controls that appear to work but do nothing.

          `/papers/disclaimer`, `/papers/privacy` and `/tag` used to be stubs
          too. They are real ports now: `papers.php` and `tag.php` are small,
          fully-readable legacy pages (see `PapersPage` and `TagPage`), and
          `tag.php` in particular already shipped the honest "no tags table"
          message itself — a generic "not converted" notice was less accurate
          than the page it replaced.
        */}
        <Route path="/papers/disclaimer" element={<PapersPage which="disclaimer" />} />
        <Route path="/papers/privacy" element={<PapersPage which="privacy" />} />
        <Route path="/tag" element={<TagPage />} />
        <Route
          path="/register"
          element={
            <NotYetAvailablePage
              title="Register"
              phase="Phase 5 (a recorded decision about the Polaris write path)"
              detail="Creating an account writes a new row into the hotel's users table, which the plan makes an explicit decision gate rather than something to enable quietly."
            />
          }
        />
        <Route
          path="/credits/club"
          element={
            <NotYetAvailablePage
              title="Retro Club"
              phase="Phase 5 (the Club handoff)"
              detail="Club membership lives in the hotel's subscription table and the legacy page was a purchasing flow, neither of which is ported."
            />
          }
        />
        <Route
          path="/credits/pixels"
          element={
            <NotYetAvailablePage
              title="Pixels"
              phase="Phase 8"
              detail="The legacy pixels page was a purchasing flow with its own catalogue, which is not ported."
            />
          }
        />
        <Route
          path="/habblet/proxy.php"
          element={
            <NotYetAvailablePage
              title="Habblet tabs"
              phase="Phase 7 (rooms, discussions and tags)"
              detail="The community page's tab bodies were AJAX-loaded from this endpoint by the legacy page's own JavaScript. Those habblets have no anonymous API here yet, so there is nothing to load."
            />
          }
        />

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </>
  );
}
