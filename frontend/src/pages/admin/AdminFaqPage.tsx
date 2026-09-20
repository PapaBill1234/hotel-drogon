import { FormEvent, useState } from 'react';

import {
  AdminNotice,
  AdminPage,
  AdminTable,
  CheckField,
  TextField,
} from './AdminChrome';
import { splitFieldError, useAdminMutations, useFaqList } from '../../hooks/useAdminContent';
import type { AdminFaq, FaqPayload } from '../../types/admin';

/**
 * `housekeeping/faq.php` against `/api/admin/faq` (staff rank >= 5).
 *
 * Legacy behaviour reproduced:
 *   - the same five fields with the same labels (Category, Question, Answer,
 *     Display order, Active) and the same control types;
 *   - the same defaults for a new entry (`category = 'general'`,
 *     `sort_order = 0`, `active = 1`) — read from the legacy `$entry`
 *     initialiser, not guessed;
 *   - `maxlength="100"` on Category and `maxlength="255"` on Question, which
 *     match `phpretro_faq`'s column widths and the service's own validation;
 *   - required-field failures reported rather than dropped.
 *
 * On update, the API answers `"FAQ entry not found"` when `affectedRows()` is
 * 0, which also covers "submitted unchanged"; the legacy page said "unchanged
 * or not found" for exactly that reason. The server's wording is shown as-is.
 */

type Mode = 'list' | 'create' | 'edit';

const EMPTY: FaqPayload = {
  category: 'general',
  question: '',
  answer: '',
  sort_order: 0,
  active: true,
};

export default function AdminFaqPage() {
  const list = useFaqList();
  const mutations = useAdminMutations();

  const [mode, setMode] = useState<Mode>('list');
  const [editingId, setEditingId] = useState(0);
  const [form, setForm] = useState<FaqPayload>(EMPTY);
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

  function startEdit(item: AdminFaq) {
    setMode('edit');
    setEditingId(item.id);
    setForm({
      category: item.category,
      question: item.question,
      answer: item.answer,
      sort_order: item.sort_order,
      active: item.active,
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
          ? await mutations.updateFaq.mutateAsync({ id: editingId, payload: form })
          : await mutations.createFaq.mutateAsync(form);
      setMessage(result.message ?? 'Saved.');
      setMessageTone('ok');
      reset();
    } catch (error) {
      report(error, mode === 'edit' ? 'FAQ entry not updated' : 'FAQ entry not created');
    }
  }

  async function onDelete(item: AdminFaq) {
    setMessage(null);
    setFieldErrors({});
    try {
      const result = await mutations.deleteFaq.mutateAsync(item.id);
      setMessage(result.message ?? 'FAQ entry removed.');
      setMessageTone('ok');
      if (editingId === item.id) reset();
    } catch (error) {
      report(error, 'FAQ entry not removed');
    }
  }

  const saving = mutations.createFaq.isPending || mutations.updateFaq.isPending;

  return (
    <AdminPage title="FAQ">
      {message !== null && (
        <AdminNotice tone={messageTone} testId="admin-notice">
          {message}
        </AdminNotice>
      )}

      {mode === 'list' ? (
        <>
          <div className="hk-toolbar">
            <button type="button" onClick={startCreate} data-testid="faq-new">
              New FAQ entry
            </button>
          </div>

          {list.isLoading && <p>Loading FAQ entries…</p>}
          {list.isError && (
            <AdminNotice tone="error">Could not load FAQ: {list.error.message}</AdminNotice>
          )}

          {list.data && (
            <AdminTable headers={['Category', 'Question', 'Order', 'Visible', 'Actions']}>
              {list.data.items.length === 0 && (
                <tr>
                  <td colSpan={5} className="hk-empty">
                    No FAQ entries yet.
                  </td>
                </tr>
              )}
              {list.data.items.map((item) => (
                <tr key={item.id} data-testid={`faq-row-${item.id}`}>
                  <td>{item.category}</td>
                  <td>{item.question}</td>
                  <td>{item.sort_order}</td>
                  <td>{item.active ? 'Yes' : 'No'}</td>
                  <td className="hk-actions">
                    <button type="button" onClick={() => startEdit(item)}>
                      Edit
                    </button>{' '}
                    <button
                      type="button"
                      className="hk-secondary"
                      onClick={() => void onDelete(item)}
                      data-testid={`faq-delete-${item.id}`}
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
        <form className="hk-form" onSubmit={(e) => void onSubmit(e)} data-testid="faq-form">
          <TextField
            id="category"
            label="Category"
            value={form.category}
            onChange={(v) => setForm((c) => ({ ...c, category: v }))}
            error={fieldErrors.category}
            maxLength={100}
          />
          <TextField
            id="question"
            label="Question"
            value={form.question}
            onChange={(v) => setForm((c) => ({ ...c, question: v }))}
            error={fieldErrors.question}
            maxLength={255}
          />
          <TextField
            id="answer"
            label="Answer"
            value={form.answer}
            onChange={(v) => setForm((c) => ({ ...c, answer: v }))}
            error={fieldErrors.answer}
            multiline
          />
          <TextField
            id="sort_order"
            label="Display order"
            type="number"
            value={String(form.sort_order)}
            onChange={(v) =>
              setForm((c) => ({ ...c, sort_order: Number.parseInt(v, 10) || 0 }))
            }
            error={fieldErrors.sort_order}
          />
          <CheckField
            id="active"
            label="Active"
            checked={form.active}
            onChange={(next) => setForm((c) => ({ ...c, active: next }))}
          />

          <div className="hk-actions">
            <button type="submit" disabled={saving} data-testid="faq-save">
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
