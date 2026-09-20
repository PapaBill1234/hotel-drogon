import { FormEvent, useState } from 'react';

import {
  AdminNotice,
  AdminPage,
  AdminTable,
  CheckField,
  Field,
  TextField,
} from './AdminChrome';
import {
  splitFieldError,
  useAdminMutations,
  useCampaignsList,
} from '../../hooks/useAdminContent';
import type { AdminCampaign, CampaignPayload } from '../../types/admin';

/**
 * `housekeeping/campaigns.php` against `/api/admin/campaigns` (staff rank >= 5).
 *
 * Legacy behaviour reproduced:
 *   - the same six fields with the same labels and control types (Name,
 *     Description, Image URL, Link URL, Order, Visible);
 *   - the same defaults for a new campaign (`visible = '1'`, `sort_order = 1`);
 *   - `sort_order` clamped to a minimum of 1 (`max(1, (int) $_POST[...])`);
 *   - the legacy `%path%` token rewritten to the site path before writing, as in
 *     the banners page (`str_replace('%path%', PATH, ...)`, `PATH === '/'`);
 *   - the list shows Order, Name, Visible, with per-row Edit and Delete.
 *
 * The legacy page also *required* an image (`if ($v[0] === '' || $v[2] === '')
 * -> "Name and image are required."`). `ContentService::createCampaign` only
 * validates `name`. That difference is left as the server defines it — the API
 * is the authority and this form does not invent a stricter client rule that
 * would contradict it — and the inventory records the divergence.
 */

type Mode = 'list' | 'create' | 'edit';

const EMPTY: CampaignPayload = {
  name: '',
  desc: '',
  image: '',
  url: '',
  visible: true,
  sort_order: 1,
};

/** Legacy `str_replace('%path%', PATH, $v)` with `PATH === '/'`. */
function normalisePath(value: string): string {
  return value.replace(/%path%/g, '/');
}

export default function AdminCampaignsPage() {
  const list = useCampaignsList();
  const mutations = useAdminMutations();

  const [mode, setMode] = useState<Mode>('list');
  const [editingId, setEditingId] = useState(0);
  const [form, setForm] = useState<CampaignPayload>(EMPTY);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<'ok' | 'error'>('ok');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

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
  }

  function startEdit(item: AdminCampaign) {
    setMode('edit');
    setEditingId(item.id);
    setForm({
      name: item.name,
      desc: item.desc,
      image: item.image,
      url: item.url,
      visible: item.visible,
      sort_order: item.sort_order,
    });
    setMessage(null);
    setFieldErrors({});
  }

  function report(error: unknown, prefix: string) {
    const { field, message: text } = splitFieldError(error);
    const shown = text ?? 'Request failed.';
    setMessage(`${prefix}: ${shown}`);
    setMessageTone('error');
    setFieldErrors(field ? { [field]: shown } : {});
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setFieldErrors({});

    const payload: CampaignPayload = {
      ...form,
      image: normalisePath(form.image.trim()),
      url: normalisePath(form.url.trim()),
      sort_order: Math.max(1, form.sort_order || 1),
    };

    try {
      const result =
        mode === 'edit'
          ? await mutations.updateCampaign.mutateAsync({ id: editingId, payload })
          : await mutations.createCampaign.mutateAsync(payload);
      setMessage(result.message ?? 'Saved.');
      setMessageTone('ok');
      reset();
    } catch (error) {
      report(error, mode === 'edit' ? 'Campaign not updated' : 'Campaign not created');
    }
  }

  async function onDelete(item: AdminCampaign) {
    setMessage(null);
    setFieldErrors({});
    try {
      const result = await mutations.deleteCampaign.mutateAsync(item.id);
      setMessage(result.message ?? 'Campaign removed.');
      setMessageTone('ok');
      if (editingId === item.id) reset();
    } catch (error) {
      report(error, 'Campaign not removed');
    }
  }

  const saving = mutations.createCampaign.isPending || mutations.updateCampaign.isPending;

  return (
    <AdminPage title="Campaigns">
      {message !== null && (
        <AdminNotice tone={messageTone} testId="admin-notice">
          {message}
        </AdminNotice>
      )}

      {mode === 'list' ? (
        <>
          <div className="hk-toolbar">
            <button type="button" onClick={startCreate} data-testid="campaign-new">
              New campaign
            </button>
          </div>

          {list.isLoading && <p>Loading campaigns…</p>}
          {list.isError && (
            <AdminNotice tone="error">
              Could not load campaigns: {list.error.message}
            </AdminNotice>
          )}

          {list.data && (
            <AdminTable headers={['Order', 'Name', 'Visible', 'Actions']}>
              {list.data.items.length === 0 && (
                <tr>
                  <td colSpan={4} className="hk-empty">
                    No campaigns yet.
                  </td>
                </tr>
              )}
              {list.data.items.map((item) => (
                <tr key={item.id} data-testid={`campaign-row-${item.id}`}>
                  <td>{item.sort_order}</td>
                  <td>{item.name}</td>
                  <td>{item.visible ? 'On' : 'Off'}</td>
                  <td className="hk-actions">
                    <button type="button" onClick={() => startEdit(item)}>
                      Edit
                    </button>{' '}
                    <button
                      type="button"
                      className="hk-secondary"
                      onClick={() => void onDelete(item)}
                      data-testid={`campaign-delete-${item.id}`}
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
        <form
          className="hk-form"
          onSubmit={(e) => void onSubmit(e)}
          data-testid="campaign-form"
        >
          <TextField
            id="name"
            label="Name"
            value={form.name}
            onChange={(v) => setForm((c) => ({ ...c, name: v }))}
            error={fieldErrors.name}
            maxLength={255}
          />
          <TextField
            id="desc"
            label="Description"
            value={form.desc}
            onChange={(v) => setForm((c) => ({ ...c, desc: v }))}
            error={fieldErrors.desc}
            maxLength={255}
          />
          <TextField
            id="image"
            label="Image URL"
            value={form.image}
            onChange={(v) => setForm((c) => ({ ...c, image: v }))}
            error={fieldErrors.image}
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
            id="visible"
            label="Visible"
            checked={form.visible}
            onChange={(next) => setForm((c) => ({ ...c, visible: next }))}
          />

          <div className="hk-actions">
            <button type="submit" disabled={saving} data-testid="campaign-save">
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
