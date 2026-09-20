import { FormEvent, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';

import { AdminNotice, AdminPage, Field, HighTrustWarning } from './AdminChrome';
import { splitFieldError, useAdminMutations, useSettingsList } from '../../hooks/useAdminContent';
import { looksLikeRawMarkup } from '../../services/apiAdmin';
import type { AdminSession } from '../../types/admin';

/**
 * `housekeeping/settings.php` against `/api/admin/settings`.
 *
 * ## Legacy behaviour reproduced
 *
 *   - only keys that already exist in `phpretro_site_settings` are editable —
 *     "New keys are not created from this form", which is why the page renders
 *     one labelled input per existing key and never offers an add row;
 *   - unchanged rows are skipped, and the panel says so ("No settings
 *     changed.") instead of reporting a save that wrote nothing;
 *   - a success notice after the values are re-read from the server.
 *
 * ## Deliberate differences (recorded in the inventory)
 *
 *   - The legacy page was gated at rank 7 and posted every key at once. The API
 *     endpoint is gated at staff rank 5 for ordinary values and escalates to the
 *     high-trust capability (rank >= 7) only when the *value* carries raw
 *     markup. Settings are therefore submitted one key per call, and each key's
 *     result is reported separately — a single 403 on one raw-HTML key no longer
 *     discards the other keys' saves.
 *   - The legacy page regenerated a settings cache (`$settings->generateCache()`)
 *     after a write. The Drogon backend reads `phpretro_site_settings` per
 *     request and has no such cache, so there is nothing to invalidate.
 *
 * The raw value is never rendered as markup: it stays in an input's `value`.
 */

export default function AdminSettingsPage() {
  const session = useOutletContext<AdminSession>();
  const list = useSettingsList();
  const mutations = useAdminMutations();

  /** Local edits, keyed by setting key. Absent means "unchanged". */
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<'ok' | 'error'>('ok');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const items = useMemo(() => list.data?.items ?? [], [list.data]);

  /** True when any *edited* value would need the high-trust capability to write. */
  const anyRawMarkup = useMemo(
    () =>
      Object.entries(edits).some(
        ([key, value]) => value !== lookup(items, key) && looksLikeRawMarkup(value),
      ),
    [edits, items],
  );

  function valueOf(key: string): string {
    return edits[key] ?? lookup(items, key);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setFieldErrors({});

    const changed = Object.entries(edits).filter(([key, value]) => value !== lookup(items, key));
    if (changed.length === 0) {
      setMessage('No settings changed.');
      setMessageTone('ok');
      return;
    }

    const saved: string[] = [];
    const failed: string[] = [];
    const errors: Record<string, string> = {};

    for (const [key, value] of changed) {
      try {
        const result = await mutations.setSetting.mutateAsync({ key, value });
        saved.push(result.high_trust ? `${key} (high-trust write)` : key);
      } catch (error) {
        const { field, message: text } = splitFieldError(error);
        failed.push(`${key} — ${text ?? 'request failed'}`);
        if (field) errors[field] = text ?? 'rejected';
      }
    }

    setFieldErrors(errors);
    if (failed.length === 0) {
      setMessage(`Settings saved: ${saved.join(', ')}.`);
      setMessageTone('ok');
      setEdits({});
      return;
    }
    setMessage(
      `Saved ${saved.length} key(s)${saved.length > 0 ? `: ${saved.join(', ')}` : ''}. ` +
        `Failed ${failed.length}: ${failed.join('; ')}`,
    );
    setMessageTone('error');
  }

  return (
    <AdminPage title="Site settings">
      {message !== null && (
        <AdminNotice tone={messageTone} testId="admin-notice">
          {message}
        </AdminNotice>
      )}

      {anyRawMarkup && (
        <HighTrustWarning>
          One or more edited values contain raw HTML/script. The public pages echo some of
          these settings <em>without escaping</em>, so writing them needs the high-trust
          content permission (rank 7+). Your staff session is rank {session.rank}
          {session.high_trust ? ' (high-trust enabled)' : ' (high-trust NOT enabled)'}.
        </HighTrustWarning>
      )}

      <p>
        Only keys already in <code>phpretro_site_settings</code> can be changed. New keys
        are not created from this form.
      </p>

      {list.isLoading && <p>Loading settings…</p>}
      {list.isError && (
        <AdminNotice tone="error">Could not load settings: {list.error.message}</AdminNotice>
      )}

      {list.data && (
        <form className="hk-form" onSubmit={(e) => void onSubmit(e)} data-testid="settings-form">
          {items.length === 0 && <p className="hk-empty">No settings rows exist yet.</p>}

          {items.map((item) => (
            <Field
              key={item.key}
              id={`setting-${item.key}`}
              label={item.key}
              error={fieldErrors[item.key]}
            >
              <input
                id={`setting-${item.key}`}
                name={item.key}
                type="text"
                value={valueOf(item.key)}
                onChange={(e) =>
                  setEdits((current) => ({ ...current, [item.key]: e.target.value }))
                }
              />
            </Field>
          ))}

          {items.length > 0 && (
            <div className="hk-actions">
              <button
                type="submit"
                disabled={mutations.setSetting.isPending}
                data-testid="settings-save"
              >
                {mutations.setSetting.isPending ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                className="hk-secondary"
                onClick={() => {
                  setEdits({});
                  setMessage(null);
                  setFieldErrors({});
                }}
              >
                Discard changes
              </button>
            </div>
          )}
        </form>
      )}
    </AdminPage>
  );
}

function lookup(
  items: { key: string; value: string }[],
  key: string,
): string {
  return items.find((item) => item.key === key)?.value ?? '';
}
