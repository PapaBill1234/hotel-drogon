import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import { useAdminSession, useMe } from '../../hooks/useAdminContent';
import { adminLogout, HIGH_TRUST_MIN_RANK, STAFF_MIN_RANK } from '../../services/apiAdmin';
import '../../styles/admin.css';

/**
 * Chrome and access gate for the converted housekeeping screens.
 *
 * ## Access model
 *
 * Two independent sessions are involved, and both are required:
 *
 *   - `hotel_session`       -> the public user session (`/api/auth/me`)
 *   - `hotel_staff_session` -> the staff session (`/api/admin/session`,
 *                              created by `/api/auth/staff-login`)
 *
 * The staff session is the one `AuthPolicy::requireStaff` reads, and CSRF is
 * validated against the *user* session's token, so the panel cannot work with
 * either half alone. `HousekeepingLoginPage` establishes both; this layout only
 * verifies that they exist and reports which of the three states the operator is
 * in, rather than guessing from a rank copied into the client.
 *
 * ## Navigation
 *
 * Only routes that have a working `/api/admin/*` endpoint are linked. The legacy
 * menu listed catalogue, newsletter, vouchers, users, bans, alerts, reports and
 * more; those have no implemented endpoint yet and are therefore absent rather
 * than rendered as dead links — the same rule the plan applies to refused
 * features (rule 6: record a gap; never fake it).
 */

const NAV_GROUPS: { title: string; items: { to: string; label: string }[] }[] = [
  {
    title: 'Tools',
    items: [
      { to: '/housekeeping/news', label: 'News' },
      { to: '/housekeeping/faq', label: 'FAQ' },
      { to: '/housekeeping/banners', label: 'Banners' },
      { to: '/housekeeping/campaigns', label: 'Campaigns' },
      { to: '/housekeeping/collectables', label: 'Collectibles' },
    ],
  },
  {
    title: 'Settings',
    items: [{ to: '/housekeeping/settings', label: 'Site settings' }],
  },
];

export function navClass({ isActive }: { isActive: boolean }): string {
  return isActive ? 'hk-current' : '';
}

export default function AdminLayout() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const me = useMe();
  const isStaffByRank = (me.data?.user.rank ?? 0) >= STAFF_MIN_RANK;
  const staff = useAdminSession(isStaffByRank);

  async function signOut() {
    try {
      await adminLogout();
    } catch {
      // A failed server-side logout must still take the operator off the panel;
      // the cookie-clearing response is best-effort here and the next request
      // will re-evaluate the session anyway.
    }
    queryClient.clear();
    navigate('/housekeeping/login', { replace: true });
  }

  if (me.isLoading || (isStaffByRank && staff.isLoading)) {
    return (
      <div className="hk-admin">
        <div className="hk-panel">
          <div className="hk-header">
            <span className="hk-header-title">PHPRetro Housekeeping</span>
          </div>
          <div className="hk-body">
            <div className="hk-main">
              <div className="hk-content" data-testid="admin-loading">
                Checking your staff session…
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (me.isError || !me.data) {
    return <AccessBlocked reason="signed-out" />;
  }

  if (!isStaffByRank) {
    return (
      <AccessBlocked
        reason="not-staff"
        username={me.data.user.username}
        rank={me.data.user.rank}
      />
    );
  }

  if (staff.isError || !staff.data) {
    // Signed in and rank-qualified, but without the separate staff session —
    // e.g. the browser was reloaded after only the public login, or the 2h
    // staff session expired while the 7d user session did not.
    return <AccessBlocked reason="no-staff-session" username={me.data.user.username} />;
  }

  const session = staff.data;

  return (
    <div className="hk-admin">
      <div className="hk-panel">
        <div className="hk-header">
          <span className="hk-header-title">PHPRetro Housekeeping</span>
          <span className="hk-header-session" data-testid="admin-session">
            {session.username} (rank {session.rank}) ·{' '}
            {session.high_trust
              ? 'high-trust content enabled'
              : `raw HTML needs rank ${HIGH_TRUST_MIN_RANK}+`}{' '}
            ·{' '}
            <button
              type="button"
              className="hk-secondary"
              onClick={() => void signOut()}
              data-testid="admin-logout"
            >
              Log out
            </button>
          </span>
        </div>

        <div className="hk-body">
          <nav className="hk-nav" aria-label="Housekeeping sections">
            {NAV_GROUPS.map((group) => (
              <div className="hk-nav-group" key={group.title}>
                <div className="hk-nav-group-title">{group.title}</div>
                <ul>
                  {group.items.map((item) => (
                    <li key={item.to}>
                      <NavLink to={item.to} className={navClass}>
                        {item.label}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>

          <div className="hk-main">
            <Outlet context={session} />
          </div>
        </div>
      </div>

      <div className="hk-footer">
        Powered by <a href="http://www.phpretro.com/">PHPRetro</a> · Housekeeping design
        based on the 2009 panel by xsixteen and Tsuka
        <br />
        HABBO is a registered trademark of Sulake Corporation. All rights reserved to
        their respective owner(s).
      </div>
    </div>
  );
}

/**
 * The three states that are not "you may use the panel", each with the exact
 * next action. A generic "access denied" would leave an operator who is signed
 * in at rank 7 with no idea that a second, separate session is missing.
 */
function AccessBlocked({
  reason,
  username,
  rank,
}: {
  reason: 'signed-out' | 'not-staff' | 'no-staff-session';
  username?: string;
  rank?: number;
}) {
  const copy: Record<typeof reason, { title: string; body: string; cta: string }> = {
    'signed-out': {
      title: 'Staff sign-in required',
      body: 'You are not signed in. Sign in with a staff account to use housekeeping.',
      cta: 'Go to staff sign-in',
    },
    'not-staff': {
      title: 'Not a staff account',
      body: `${username ?? 'This account'} has rank ${rank ?? 1}. Housekeeping needs rank ${STAFF_MIN_RANK} or above.`,
      cta: 'Sign in as staff',
    },
    'no-staff-session': {
      title: 'Staff session required',
      body: `Signed in as ${username ?? 'a staff account'}, but this browser holds no separate staff session. Staff sessions last 2 hours and are created by the staff sign-in step.`,
      cta: 'Start a staff session',
    },
  };

  const { title, body, cta } = copy[reason];

  return (
    <div className="hk-admin">
      <div className="hk-panel">
        <div className="hk-header">
          <span className="hk-header-title">PHPRetro Housekeeping</span>
        </div>
        <div className="hk-body">
          <div className="hk-main">
            <div className="hk-page-title">{title}</div>
            <div className="hk-content" data-testid="admin-blocked" data-reason={reason}>
              <div className="hk-notice hk-notice-error">{body}</div>
              <Link className="hk-button" to="/housekeeping/login">
                {cta}
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
