import { Link, useOutletContext } from 'react-router-dom';

import { AdminNotice, AdminPage } from './AdminChrome';
import type { AdminSession } from '../../types/admin';

/**
 * Landing page for the converted housekeeping panel.
 *
 * The legacy equivalent is `housekeeping/dashboard.php`. Only sections with a
 * working `/api/admin/*` endpoint behind them are listed: the legacy dashboard
 * linked catalogue, newsletter, vouchers, users, bans, alerts and reports, none
 * of which the C++ backend implements yet. Plan rule 6 requires those to be
 * recorded as gaps rather than rendered as controls that cannot work, so the
 * page states plainly what is not here instead of offering dead links.
 */

const SECTIONS: { to: string; label: string; note: string }[] = [
  {
    to: '/housekeeping/news',
    label: 'News',
    note: 'phpretro_news — create, edit, delete articles.',
  },
  {
    to: '/housekeeping/faq',
    label: 'FAQ',
    note: 'phpretro_faq — questions, categories, order, visibility.',
  },
  {
    to: '/housekeeping/banners',
    label: 'Banners',
    note: 'phpretro_banners — text, image, link, order. Raw HTML needs rank 7+.',
  },
  {
    to: '/housekeeping/campaigns',
    label: 'Campaigns',
    note: 'phpretro_campaigns — name, description, image, link, order.',
  },
  {
    to: '/housekeeping/collectables',
    label: 'Collectibles',
    note: 'phpretro_collectibles — one per month. Create and delete only.',
  },
  {
    to: '/housekeeping/settings',
    label: 'Site settings',
    note: 'phpretro_site_settings — existing keys only.',
  },
];

export default function AdminHomePage() {
  const session = useOutletContext<AdminSession>();

  return (
    <AdminPage title="Dashboard">
      <AdminNotice testId="admin-welcome">
        Signed in as <strong>{session.username}</strong> with staff rank {session.rank}. Staff
        sessions last 2 hours and are separate from your site session.
      </AdminNotice>

      <ul data-testid="admin-sections">
        {SECTIONS.map((section) => (
          <li key={section.to}>
            <Link to={section.to}>{section.label}</Link> — {section.note}
          </li>
        ))}
      </ul>

      <h2>Not implemented here yet</h2>
      <p>
        The legacy housekeeping panel also had catalogue, newsletter, recommended, vouchers,
        users, bans, alerts, help desk, reports, staff sessions, 2FA enrolment, logs, cache and
        maintenance screens. The C++ backend has no endpoints for them, so they are deliberately
        absent from this panel rather than shown as controls that cannot work. They are tracked
        as gaps in <code>docs/phase1-parity-inventory.md</code>.
      </p>
    </AdminPage>
  );
}
