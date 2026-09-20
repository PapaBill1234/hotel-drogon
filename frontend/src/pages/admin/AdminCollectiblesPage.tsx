import { FormEvent, useState } from 'react';

import { AdminNotice, AdminPage, AdminTable, Field, TextField } from './AdminChrome';
import {
  splitFieldError,
  useAdminMutations,
  useCollectiblesList,
} from '../../hooks/useAdminContent';
import { formatMonthYear } from '../../services/legacy';
import type { CollectiblePayload } from '../../types/admin';

/**
 * `housekeeping/collectables.php` against `/api/admin/collectibles`.
 *
 * ## Legacy behaviour reproduced
 *
 *   - the same four fields with the same labels and control types (Name,
 *     Description, Image URL, Month timestamp);
 *   - the new-entry default for `time` is the first instant of the current
 *     month (`strtotime(date('Y-m-01 00:00:00'))`), which is what makes the row
 *     the "current collectable" on `/credits/collectables`;
 *   - the list column shows `date('F Y', $time)` and is ordered by `time DESC`;
 *   - required-field failures are reported.
 *
 * ## The legacy "Month timestamp" number box
 *
 * Legacy rendered a raw epoch `<input type="number">`. Reproducing that in a
 * React panel would be a usability regression dressed up as parity, so the
 * field is a `<input type="month">` that reads and writes the same epoch value
 * (first instant of the chosen month, local time). The stored column is
 * unchanged; the inventory records the mapping.
 *
 * ## Missing capability
 *
 * `AdminContentController` exposes create and delete only — there is no
 * `PUT /api/admin/collectibles/{id}`. The list therefore has no Edit action,
 * whereas the legacy page had one. That is an API gap, not a UI choice, and it
 * is recorded in the inventory rather than hidden behind a disabled button.
 */

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

  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<CollectiblePayload>(() => ({
    ...EMPTY,
    time: currentMonthStart(),
  }));
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<'ok' | 'error'>('ok');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function startCreate() {
    setCreating(true);
    setForm({ ...EMPTY, time: currentMonthStart() });
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
      const result = await mutations.createCollectible.mutateAsync(form);
      setMessage(result.message ?? 'Collectible created.');
      setMessageTone('ok');
      setCreating(false);
      setForm({ ...EMPTY, time: currentMonthStart() });
    } catch (error) {
      report(error, 'Collectible not created');
    }
  }

  async function onDelete(id: number) {
    setMessage(null);
    setFieldErrors({});
    try {
      const result = await mutations.deleteCollectible.mutateAsync(id);
      setMessage(result.message ?? 'Collectible removed.');
      setMessageTone('ok');
    } catch (error) {
      report(error, 'Collectible not removed');
    }
  }

  return (
    <AdminPage title="Collectibles">
      {message !== null && (
        <AdminNotice tone={messageTone} testId="admin-notice">
          {message}
        </AdminNotice>
      )}

      {creating ? (
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
            <button
              type="submit"
              disabled={mutations.createCollectible.isPending}
              data-testid="collectible-save"
            >
              {mutations.createCollectible.isPending ? 'Saving…' : 'Save'}
            </button>
            <button type="button" className="hk-secondary" onClick={() => setCreating(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
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
            <>
              <AdminNotice testId="collectible-no-edit">
                Collectibles can be created and deleted here, but not edited: the admin API
                exposes no update endpoint for this resource yet.
              </AdminNotice>
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
                      <button
                        type="button"
                        className="hk-secondary"
                        onClick={() => void onDelete(item.id)}
                        data-testid={`collectible-delete-${item.id}`}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </AdminTable>
            </>
          )}
        </>
      )}
    </AdminPage>
  );
}
