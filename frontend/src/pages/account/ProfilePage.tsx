import { FormEvent, useState } from 'react';

import AccountPage from '../../components/AccountPage';
import {
  LOOK_MAX_CHARS,
  MOTTO_MAX_CHARS,
  PASSWORD_MIN_CHARS,
} from '../../services/apiAccount';
import {
  useChangePassword,
  useUpdateEmail,
  useUpdateLook,
  useUpdateMotto,
} from '../../hooks/useAccount';
import type { User } from '../../types/account';

/**
 * `/account/profile` — the converted `profile.php`.
 *
 * ## What legacy `profile.php` did
 *
 * It handled one POST for the profile fields, then re-read and rendered the
 * form:
 *
 *   $motto  = trim($_POST['motto']);  $look = trim($_POST['look']);
 *   $gender = $_POST['gender'];
 *   if (mb_strlen($motto) > 127 || mb_strlen($look) > 256
 *       || !in_array($gender, ['M','F'], true)) { $notice = 'Invalid profile details.'; }
 *   else { UPDATE users SET motto=?, look=?, gender=? WHERE id=?; $notice = 'Profile updated.'; }
 *
 * Two properties of that are load-bearing and are reproduced here:
 *
 *  1. it **rejected** invalid input rather than repairing it, and
 *  2. it **trimmed** the submitted values before measuring and storing them.
 *
 * The current API used to do neither (it truncated the motto to 128 bytes and
 * coerced an unknown gender to `M`); both were corrected in the same work unit
 * as this page, and the limits below mirror the server so the form refuses
 * before spending a request. The server stays the authority.
 *
 * ## Why email and password are separate forms
 *
 * Legacy `profile.php` had no email or password field at all — those belong to
 * other legacy entry points. The API does implement both
 * (`/api/account/email`, `/api/account/password`), and the Phase 5 slice is
 * "supported profile edits", so they are offered here as their own forms rather
 * than folded into the legacy shape: each has different validation, a different
 * failure mode (the password form's 401 for a wrong current password) and a
 * different side effect (a new email resets `mail_verified`). Keeping them
 * separate keeps each form's success and failure attributable.
 */
export default function ProfilePage() {
  return (
    <AccountPage pageName="Edit profile" pageId="profile">
      {(user) => <ProfileContent user={user} />}
    </AccountPage>
  );
}

function ProfileContent({ user }: { user: User }) {
  return (
    <div id="container">
      <div id="content" className="clearfix">
        <div id="column1" className="column">
          <div className="habblet-container">
            <div className="cbb clearfix default">
              <h2 className="title">Edit profile</h2>
              <div className="box-content">
                <p>
                  Account: <strong data-testid="profile-username">{user.username}</strong>
                </p>
                <p>
                  Email: <span data-testid="profile-current-email">{user.mail}</span>
                  {!user.mail_verified && (
                    <span data-testid="profile-email-unverified"> (not verified)</span>
                  )}
                </p>
              </div>
            </div>
          </div>

          <MottoAndFigureForm user={user} />
          <EmailForm user={user} />
          <PasswordForm />
        </div>
      </div>
    </div>
  );
}

/** A notice that mirrors legacy's `$notice`: one message, success or failure. */
function Notice({ kind, text }: { kind: 'ok' | 'error'; text: string }) {
  const testId = kind === 'ok' ? 'profile-notice' : 'profile-error';
  return (
    <p className={kind === 'error' ? 'error' : undefined} data-testid={testId}>
      {text}
    </p>
  );
}

function MottoAndFigureForm({ user }: { user: User }) {
  const [motto, setMotto] = useState(user.motto);
  const [look, setLook] = useState(user.look);
  const [gender, setGender] = useState<'M' | 'F'>(user.gender === 'F' ? 'F' : 'M');
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const mottoMutation = useUpdateMotto();
  const lookMutation = useUpdateLook();
  const busy = mottoMutation.isPending || lookMutation.isPending;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);

    // Measure what legacy measured: the trimmed value.
    const trimmedMotto = motto.trim();
    const trimmedLook = look.trim();

    if (trimmedMotto.length > MOTTO_MAX_CHARS || trimmedLook.length > LOOK_MAX_CHARS) {
      setNotice({ kind: 'error', text: 'Invalid profile details.' });
      return;
    }

    // Two endpoints, because `/api/account/motto` and `/api/account/look` are
    // separate named methods. Legacy `profile.php` saved both in ONE UPDATE, so
    // a partial failure is possible here and legacy had no equivalent state.
    // It is reported as a partial save rather than as success: the MottoAndFigure
    // heading fields have already been written and will show as saved after the
    // query invalidation, and telling the visitor "Profile updated." while the
    // figure silently did not persist would be exactly the kind of simulated
    // success the plan forbids.
    const failed: string[] = [];
    try {
      await mottoMutation.mutateAsync({ motto: trimmedMotto });
    } catch {
      failed.push('motto');
    }
    try {
      await lookMutation.mutateAsync({ look: trimmedLook, gender });
    } catch {
      failed.push('figure');
    }

    setNotice(
      failed.length === 0
        ? { kind: 'ok', text: 'Profile updated.' }
        : { kind: 'error', text: `Your ${failed.join(' and ')} could not be saved.` },
    );
  }

  return (
    <div className="habblet-container">
      <div className="cbb clearfix default">
        <h2 className="title">Profile</h2>
        <div className="box-content">
          {notice !== null && <Notice kind={notice.kind} text={notice.text} />}
          <form onSubmit={(e) => void onSubmit(e)}>
            <label htmlFor="profile-motto">Motto</label>
            <br />
            <input
              id="profile-motto"
              name="motto"
              type="text"
              maxLength={MOTTO_MAX_CHARS}
              value={motto}
              onChange={(e) => setMotto(e.target.value)}
            />
            <br />
            <label htmlFor="profile-look">Figure</label>
            <br />
            <input
              id="profile-look"
              name="look"
              type="text"
              maxLength={LOOK_MAX_CHARS}
              value={look}
              onChange={(e) => setLook(e.target.value)}
            />
            <br />
            <label htmlFor="profile-gender">Gender</label>
            <br />
            <select
              id="profile-gender"
              name="gender"
              value={gender}
              onChange={(e) => setGender(e.target.value === 'F' ? 'F' : 'M')}
            >
              <option value="M">M</option>
              <option value="F">F</option>
            </select>
            <br />
            <button type="submit" disabled={busy} data-testid="profile-save">
              {busy ? 'Saving…' : 'Save'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

function EmailForm({ user }: { user: User }) {
  const [email, setEmail] = useState(user.mail);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const mutation = useUpdateEmail();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);

    // The handler's own rule is "contains an @"; checking the same thing here
    // keeps the client honest without inventing a stricter policy than the
    // server enforces.
    if (!email.includes('@')) {
      setNotice({ kind: 'error', text: 'Invalid email format.' });
      return;
    }

    try {
      await mutation.mutateAsync({ email });
      setNotice({ kind: 'ok', text: 'Email updated. It must be verified again.' });
    } catch (err) {
      setNotice({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Email update failed.',
      });
    }
  }

  return (
    <div className="habblet-container">
      <div className="cbb clearfix default">
        <h2 className="title">Email</h2>
        <div className="box-content">
          {notice !== null && <Notice kind={notice.kind} text={notice.text} />}
          <form onSubmit={(e) => void onSubmit(e)}>
            <label htmlFor="profile-email">Email address</label>
            <br />
            <input
              id="profile-email"
              name="email"
              type="text"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <br />
            <button type="submit" disabled={mutation.isPending} data-testid="email-save">
              {mutation.isPending ? 'Saving…' : 'Save email'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

function PasswordForm() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const mutation = useChangePassword();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);

    if (newPassword.length < PASSWORD_MIN_CHARS) {
      setNotice({
        kind: 'error',
        text: `New password must be at least ${PASSWORD_MIN_CHARS} characters.`,
      });
      return;
    }

    try {
      await mutation.mutateAsync({ currentPassword, newPassword });
      // The server keeps the existing session valid after a change, so the
      // visitor is not signed out here either — saying so avoids the impression
      // that they must sign in again.
      setNotice({ kind: 'ok', text: 'Password successfully changed.' });
      setCurrentPassword('');
      setNewPassword('');
    } catch (err) {
      setNotice({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Password change failed.',
      });
    }
  }

  return (
    <div className="habblet-container">
      <div className="cbb clearfix default">
        <h2 className="title">Password</h2>
        <div className="box-content">
          {notice !== null && <Notice kind={notice.kind} text={notice.text} />}
          <form onSubmit={(e) => void onSubmit(e)}>
            <label htmlFor="profile-current-password">Current password</label>
            <br />
            <input
              id="profile-current-password"
              name="current_password"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
            <br />
            <label htmlFor="profile-new-password">New password</label>
            <br />
            <input
              id="profile-new-password"
              name="new_password"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
            <br />
            <button type="submit" disabled={mutation.isPending} data-testid="password-save">
              {mutation.isPending ? 'Saving…' : 'Change password'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
