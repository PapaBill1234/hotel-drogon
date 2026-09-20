import { FormEvent, useState } from 'react';
import { useOutletContext } from 'react-router-dom';

import {
  AdminNotice,
  AdminPage,
  AdminTable,
  CheckField,
  Field,
  HighTrustWarning,
  TextField,
} from './AdminChrome';
import { splitFieldError, useAdminMutations, useBannersList } from '../../hooks/useAdminContent';
import type { AdminBanner, AdminSession, BannerPayload } from '../../types/admin';
import { AdminApiError } from '../../services/apiAdmin';

/**
 * `housekeeping/banners.php` against `/api/admin/banners`.
 *
 * ## Legacy behaviour reproduced
 *
 *   - the same fields and control types: Text, Image URL, Link URL,
 *     HTML (advanced, textarea), Order, Visible;
 *   - `advanced` is derived from the HTML field exactly as the legacy page
 *     derived it (`$advanced = $html !== '' ? '1' : '0'`), rather than being a
 *     separate checkbox the operator could set inconsistently;
 *   - `sort_order` is clamped to a minimum of 1 (`max(1, (int) $_POST[...])`);
 *   - the legacy `%path%` token was replaced with the site path before the row
 *     was written. `PATH` was the install path (`/`), so `%path%` is normalised
 *     to `/` on save here as well — otherwise an operator copying a legacy row
 *     by hand would silently introduce a literal `%path%` into the database.
 *   - the list column shows `HTML` for an advanced row, otherwise the image or
 *     the text.
 *
 * ## Stricter than legacy (recorded in the inventory)
 *
 * The legacy page let any rank-5 staff member write arbitrary markup into
 * `phpretro_banners.html`, which the public pages then echo unescaped. Here
 * that write requires the separate high-trust capability (rank >= 7), enforced
 * in `AdminContentController` *and* again in `ContentService`. This form warns
 * before the submit; the server is the authority and its denial is displayed.
 *
 * The raw `html` value is never rendered as markup anywhere in this panel — it
 * is only ever an editable `<textarea>` value.
 */

type Mode = 'list' | 'create' | 'edit';

const EMPTY: BannerPayload = {
  text: '',
  banner: '',
  url: '',
  status: true,
  advanced: false,
  html: '',
  sort_order: 1,
};

/** Legacy `str_replace('%path%', PATH, $v)` with `PATH === '/'`. */
function normalisePath(value: string): string {
  return value.replace(/%path%/g, '/');
}

export default function AdminBannersPage() {
  const session = useOutletContext<AdminSession>();
  const list = useBannersList();
  const mutations = useAdminMutations();

  const [mode, setMode] = useState<Mode>('list');
  const [editingId, setEditingId] = useState(0);
  const [form, setForm] = useState<BannerPayload>(EMPTY);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<'ok' | 'error'>('ok');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  /** Set when the last save was refused for lack of the high-trust capability. */
  const [highTrustDenied, setHighTrustDenied] = useState(false);

  function reset() {
    setMode('list');
    setEditingId(0);
    setForm(EMPTY);
    setFieldErrors({});
  }

  function startCreate() {
    setMode('create');
    setEditingId(0);
    setForm(EMPTY);
    setMessage(null);
    setFieldErrors({});
    setHighTrustDenied(false);
  }

  function startEdit(item: AdminBanner) {
    setMode('edit');
    setEditingId(item.id);
    setForm({
      text: item.text,
      banner: item.banner,
      url: item.url,
      status: item.status,
      advanced: item.advanced,
      // Absent when the operator lacks the high-trust capability; the API
      // reports that explicitly via `raw_html_included` and `notice`.
      html: item.html ?? '',
      sort_order: item.sort_order,
    });
    setMessage(null);
    setFieldErrors({});
    setHighTrustDenied(false);
  }

  function report(error: unknown, prefix: string) {
    const { field, message: text } = splitFieldError(error);
    const shown = text ?? 'Request failed.';
    setMessage(`${prefix}: ${shown}`);
    setMessageTone('error');
    setFieldErrors(field ? { [field]: shown } : {});
    setHighTrustDenied(
      error instanceof AdminApiError && error.status === 403 && field === 'html',
    );
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setFieldErrors({});
    setHighTrustDenied(false);

    const payload: BannerPayload = {
      ...form,
      banner: normalisePath(form.banner.trim()),
      url: normalisePath(form.url.trim()),
      // Derived, never operator-set: the legacy page did the same.
      advanced: form.html !== '',
      sort_order: Math.max(1, form.sort_order || 1),
    };

    try {
      const result =
        mode === 'edit'
          ? await mutations.updateBanner.mutateAsync({ id: editingId, payload })
          : await mutations.createBanner.mutateAsync(payload);
      setMessage(result.message ?? 'Saved.');
      setMessageTone('ok');
      reset();
    } catch (error) {
      report(error, mode === 'edit' ? 'Banner not updated' : 'Banner not created');
    }
  }

  async function onDelete(item: AdminBanner) {
    setMessage(null);
    setFieldErrors({});
    try {
      const result = await mutations.deleteBanner.mutateAsync(item.id);
      setMessage(result.message ?? 'Banner removed.');
      setMessageTone('ok');
      if (editingId === item.id) reset();
    } catch (error) {
      report(error, 'Banner not removed');
    }
  }

  const saving = mutations.createBanner.isPending || mutations.updateBanner.isPending;
  const rawMarkup = form.html.trim() !== '';

  return (
    <AdminPage title="Banners">
      {message !== null && (
        <AdminNotice tone={messageTone} testId="admin-notice">
          {message}
        </AdminNotice>
      )}

      {highTrustDenied && (
        <AdminNotice tone="error" testId="high-trust-denied">
          This banner contains raw HTML/script. Writing it needs the high-trust content
          permission (rank 7+); your staff session is rank {session.rank}.
        </AdminNotice>
      )}

      {mode === 'list' ? (
        <>
          {list.data && !list.data.raw_html_included && (
            <AdminNotice testId="raw-html-omitted">
              {list.data.notice ??
                'Raw HTML is omitted; the high-trust content permission is required to view or edit it.'}
            </AdminNotice>
          )}

          <div className="hk-toolbar">
            <button type="button" onClick={startCreate} data-testid="banner-new">
              New banner
            </button>
          </div>

          {list.isLoading && <p>Loading banners…</p>}
          {list.isError && (
            <AdminNotice tone="error">Could not load banners: {list.error.message}</AdminNotice>
          )}

          {list.data && (
            <AdminTable headers={['Order', 'Text', 'Data', 'Visible', 'Actions']}>
              {list.data.items.length === 0 && (
                <tr>
                  <td colSpan={5} className="hk-empty">
                    No banners yet.
                  </td>
                </tr>
              )}
              {list.data.items.map((item) => (
                <tr key={item.id} data-testid={`banner-row-${item.id}`}>
                  <td>{item.sort_order}</td>
                  {/* The legacy table had no Text column, so an advanced banner
                      showed only the word "HTML" and its text was invisible in
                      the list. Shown here because "which banner am I deleting"
                      was unanswerable otherwise. */}
                  <td>{item.text}</td>
                  <td>{item.advanced ? 'HTML' : item.banner !== '' ? item.banner : item.text}</td>
                  <td>{item.status ? 'On' : 'Off'}</td>
                  <td className="hk-actions">
                    <button type="button" onClick={() => startEdit(item)}>
                      Edit
                    </button>{' '}
                    <button
                      type="button"
                      className="hk-secondary"
                      onClick={() => void onDelete(item)}
                      data-testid={`banner-delete-${item.id}`}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </AdminTable>
          )}
        </>
      ) : (
        <form className="hk-form" onSubmit={(e) => void onSubmit(e)} data-testid="banner-form">
          <TextField
            id="text"
            label="Text"
            value={form.text}
            onChange={(v) => setForm((c) => ({ ...c, text: v }))}
            error={fieldErrors.text}
            maxLength={255}
          />
          <TextField
            id="banner"
            label="Image URL"
            value={form.banner}
            onChange={(v) => setForm((c) => ({ ...c, banner: v }))}
            error={fieldErrors.banner}
            hint="A legacy %path% token is rewritten to / on save."
            maxLength={255}
          />
          <TextField
            id="url"
            label="Link URL"
            value={form.url}
            onChange={(v) => setForm((c) => ({ ...c, url: v }))}
            error={fieldErrors.url}
            maxLength={255}
          />

          {rawMarkup && <HighTrustWarning />}

          <TextField
            id="html"
            label="HTML (advanced)"
            value={form.html}
            onChange={(v) => setForm((c) => ({ ...c, html: v }))}
            error={fieldErrors.html}
            multiline
            code
            hint="Non-empty HTML marks the banner advanced, exactly as the legacy page did."
          />

          <Field id="sort_order" label="Order">
            <input
              id="sort_order"
              name="sort_order"
              type="number"
              min={1}
              value={form.sort_order}
              onChange={(e) =>
                setForm((c) => ({ ...c, sort_order: Number.parseInt(e.target.value, 10) || 1 }))
              }
            />
          </Field>

          <CheckField
            id="status"
            label="Visible"
            checked={form.status}
            onChange={(next) => setForm((c) => ({ ...c, status: next }))}
          />

          <div className="hk-actions">
            <button type="submit" disabled={saving} data-testid="banner-save">
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button type="button" className="hk-secondary" onClick={reset}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </AdminPage>
  );
}
