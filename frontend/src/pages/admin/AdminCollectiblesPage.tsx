import { FormEvent, useState } from 'react';

import { AdminNotice, AdminPage, AdminTable, Field, TextField } from './AdminChrome';
import {
  splitFieldError,
  useAdminMutations,
  useCollectiblesList,
} from '../../hooks/useAdminContent';
import { formatMonthYear } from '../../services/legacy';
import type { AdminCollectible, CollectiblePayload } from '../../types/admin';

/**
 * `housekeeping/collectables.php` against `/api/admin/collectibles`.
 *
 * ## Legacy behaviour reproduced
 *
 *   - the same four fields with the same labels and control types (Name,
 *     Description, Image URL, Month timestamp);
 *   - the same required set on create *and* update: name, description, image and
 *     a positive month timestamp (`in_array('', array_slice($v, 0, 3), true)
 *     || $v[3] <= 0` -> "Name, description, image, and month timestamp are
 *     required."), mirrored by `ContentService::validateCollectible`;
 *   - the new-entry default for `time` is the first instant of the current month
 *     (`strtotime(date('Y-m-01 00:00:00'))`), which is what makes the row the
 *     "current collectable" on `/credits/collectables`;
 *   - the list column shows `date('F Y', $time)`, ordered by `time DESC`, with
 *     per-row Edit and Delete.
 *
 * ## The legacy "Month timestamp" number box
 *
 * Legacy rendered a raw epoch `<input type="number">`. Reproducing that in a
 * React panel would be a usability regression dressed up as parity, so the field
 * is an `<input type="month">` that reads and writes the same epoch value (first
 * instant of the chosen month, local time). The stored column is unchanged; the
 * inventory records the mapping.
 *
 * ## `time` is UNIQUE
 *
 * `phpretro_collectibles.time` carries a UNIQUE index, so one collectible per
 * month. Moving a row onto another row's month, or creating a second row for an
 * existing month, is refused by the database and reported against the Month
 * field rather than as a generic failure.
 */

type Mode = 'list' | 'create' | 'edit';

const EMPTY: CollectiblePayload = { name: '', description: '', image: '', time: 0 };

/** First instant of the current month, local time — the legacy default. */
function currentMonthStart(): number {
  const now = new Date();
  return Math.floor(new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000);
}

/** Unix seconds -> `YYYY-MM` for `<input type="month">`. */
function toMonthInput(epoch: number): string {
  if (epoch <= 0) return '';
  const d = new Date(epoch * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** `YYYY-MM` -> first instant of that month, local time, as Unix seconds. */
function fromMonthInput(value: string): number {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return 0;
  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  if (month < 1 || month > 12) return 0;
  return Math.floor(new Date(year, month - 1, 1).getTime() / 1000);
}

export default function AdminCollectiblesPage() {
  const list = useCollectiblesList();
  const mutations = useAdminMutations();

  const [mode, setMode] = useState<Mode>('list');
  const [editingId, setEditingId] = useState(0);
  const [form, setForm] = useState<CollectiblePayload>(() => ({
    ...EMPTY,
    time: currentMonthStart(),
  }));
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<'ok' | 'error'>('ok');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function reset() {
    setMode('list');
    setEditingId(0);
    setForm({ ...EMPTY, time: currentMonthStart() });
    setFieldErrors({});
  }

  function startCreate() {
    setMode('create');
    setEditingId(0);
    setForm({ ...EMPTY, time: currentMonthStart() });
    setMessage(null);
    setFieldErrors({});
  }

  function startEdit(item: AdminCollectible) {
    setMode('edit');
    setEditingId(item.id);
    setForm({
      name: item.name,
      description: item.description,
      image: item.image,
      time: item.time,
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
    try {
      const result =
        mode === 'edit'
          ? await mutations.updateCollectible.mutateAsync({ id: editingId, payload: form })
          : await mutations.createCollectible.mutateAsync(form);
      setMessage(result.message ?? 'Saved.');
      setMessageTone('ok');
      reset();
    } catch (error) {
      report(error, mode === 'edit' ? 'Collectible not updated' : 'Collectible not created');
    }
  }

  async function onDelete(item: AdminCollectible) {
    setMessage(null);
    setFieldErrors({});
    try {
      const result = await mutations.deleteCollectible.mutateAsync(item.id);
      setMessage(result.message ?? 'Collectible removed.');
      setMessageTone('ok');
      if (editingId === item.id) reset();
    } catch (error) {
      report(error, 'Collectible not removed');
    }
  }

  const saving =
    mutations.createCollectible.isPending || mutations.updateCollectible.isPending;

  return (
    <AdminPage title="Collectibles">
      {message !== null && (
        <AdminNotice tone={messageTone} testId="admin-notice">
          {message}
        </AdminNotice>
      )}

      {mode === 'list' ? (
        <>
          <div className="hk-toolbar">
            <button type="button" onClick={startCreate} data-testid="collectible-new">
              New collectible
            </button>
          </div>

          {list.isLoading && <p>Loading collectibles…</p>}
          {list.isError && (
            <AdminNotice tone="error">
              Could not load collectibles: {list.error.message}
            </AdminNotice>
          )}

          {list.data && (
            <AdminTable headers={['Name', 'Month', 'Image', 'Actions']}>
              {list.data.items.length === 0 && (
                <tr>
                  <td colSpan={4} className="hk-empty">
                    No collectibles yet.
                  </td>
                </tr>
              )}
              {list.data.items.map((item) => (
                <tr key={item.id} data-testid={`collectible-row-${item.id}`}>
                  <td>{item.name}</td>
                  <td>{formatMonthYear(item.time)}</td>
                  <td>{item.image}</td>
                  <td className="hk-actions">
                    <button type="button" onClick={() => startEdit(item)}>
                      Edit
                    </button>{' '}
                    <button
                      type="button"
                      className="hk-secondary"
                      onClick={() => void onDelete(item)}
                      data-testid={`collectible-delete-${item.id}`}
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
          data-testid="collectible-form"
        >
          <TextField
            id="name"
            label="Name"
            value={form.name}
            onChange={(v) => setForm((c) => ({ ...c, name: v }))}
            error={fieldErrors.name}
          />
          <TextField
            id="description"
            label="Description"
            value={form.description}
            onChange={(v) => setForm((c) => ({ ...c, description: v }))}
            error={fieldErrors.description}
            multiline
          />
          <TextField
            id="image"
            label="Image URL"
            value={form.image}
            onChange={(v) => setForm((c) => ({ ...c, image: v }))}
            error={fieldErrors.image}
          />
          <Field
            id="time"
            label="Month"
            error={fieldErrors.time}
            hint={`Stored as the first instant of the month: ${form.time > 0 ? formatMonthYear(form.time) : 'not set'}. phpretro_collectibles.time is UNIQUE, so one collectable per month.`}
          >
            <input
              id="time"
              name="time"
              type="month"
              value={toMonthInput(form.time)}
              onChange={(e) => setForm((c) => ({ ...c, time: fromMonthInput(e.target.value) }))}
            />
          </Field>

          <div className="hk-actions">
            <button type="submit" disabled={saving} data-testid="collectible-save">
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
