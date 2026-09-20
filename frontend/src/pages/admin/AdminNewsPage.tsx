import { FormEvent, useState } from 'react';

import {
  AdminNotice,
  AdminPage,
  AdminTable,
  Field,
  TextField,
} from './AdminChrome';
import { splitFieldError, useAdminMutations, useNewsList } from '../../hooks/useAdminContent';
import type { AdminNews, NewsPayload } from '../../types/admin';

/**
 * `housekeeping/news.php` against `/api/admin/news` (staff rank >= 5).
 *
 * Legacy behaviour reproduced:
 *   - the same six editable fields, in the same order and with the same labels
 *     (Title, Summary, Story, Author, Categories, Image URLs); Summary, Story
 *     and Image URLs are textareas and the rest are single-line inputs;
 *   - required-field failures are reported, not silently ignored;
 *   - delete is a per-row action on the list, with the list re-rendered after.
 *
 * Two deliberate differences, both recorded in the inventory:
 *   - The legacy form's save notice was one flat string ("Title, summary,
 *     story, and author are required."). The API reports the exact rejected
 *     `field`, so the message is attached to that input as well as the banner.
 *   - The legacy page wrote `time()` unconditionally on create. The API accepts
 *     an explicit `time` (0 means "now"), so publication time is editable here
 *     instead of only being settable by editing the database.
 */

type Mode = 'list' | 'create' | 'edit';

const EMPTY: NewsPayload = {
  title: '',
  summary: '',
  story: '',
  author: '',
  categories: '',
  images: '',
  time: 0,
};

/** `Date` -> Unix seconds, or 0 when the field is empty/blank. */
function toEpoch(local: string): number {
  if (local.trim() === '') return 0;
  const ms = new Date(local).getTime();
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
}

/** Unix seconds -> the `datetime-local` value in the browser's own timezone. */
export function toLocalInput(epoch: number): string {
  if (epoch === 0) return '';
  const d = new Date(epoch * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The legacy list column read `date('Y-m-d H:i', $time)`. */
function formatListDate(epoch: number): string {
  const d = new Date(epoch * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function AdminNewsPage() {
  const list = useNewsList();
  const mutations = useAdminMutations();

  const [mode, setMode] = useState<Mode>('list');
  const [editingId, setEditingId] = useState(0);
  const [form, setForm] = useState<NewsPayload>(EMPTY);
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

  function startEdit(item: AdminNews) {
    setMode('edit');
    setEditingId(item.id);
    setForm({
      title: item.title,
      summary: item.summary,
      story: item.story,
      author: item.author,
      categories: item.categories,
      images: item.images,
      time: item.time,
    });
    setMessage(null);
    setFieldErrors({});
  }

  function set<K extends keyof NewsPayload>(key: K, value: NewsPayload[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function report(error: unknown, fallbackPrefix: string) {
    const { field, message: text } = splitFieldError(error);
    const shown = text ?? 'Request failed.';
    setMessage(`${fallbackPrefix}: ${shown}`);
    setMessageTone('error');
    setFieldErrors(field ? { [field]: shown } : {});
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setFieldErrors({});

    const payload: NewsPayload = {
      title: form.title,
      summary: form.summary,
      story: form.story,
      author: form.author,
      categories: form.categories,
      images: form.images,
      time: form.time,
    };

    try {
      const result =
        mode === 'edit'
          ? await mutations.updateNews.mutateAsync({ id: editingId, payload })
          : await mutations.createNews.mutateAsync(payload);
      setMessage(result.message ?? 'Saved.');
      setMessageTone('ok');
      reset();
    } catch (error) {
      report(error, mode === 'edit' ? 'Article not updated' : 'Article not created');
    }
  }

  async function onDelete(item: AdminNews) {
    setMessage(null);
    setFieldErrors({});
    try {
      const result = await mutations.deleteNews.mutateAsync(item.id);
      setMessage(result.message ?? 'Article removed.');
      setMessageTone('ok');
      if (editingId === item.id) reset();
    } catch (error) {
      report(error, 'Article not removed');
    }
  }

  const saving =
    mutations.createNews.isPending || mutations.updateNews.isPending;

  return (
    <AdminPage title="News">
      {message !== null && (
        <AdminNotice tone={messageTone} testId="admin-notice">
          {message}
        </AdminNotice>
      )}

      {mode === 'list' ? (
        <>
          <div className="hk-toolbar">
            <button type="button" onClick={startCreate} data-testid="news-new">
              New article
            </button>
          </div>

          {list.isLoading && <p>Loading articles…</p>}
          {list.isError && (
            <AdminNotice tone="error">
              Could not load articles: {list.error.message}
            </AdminNotice>
          )}

          {list.data && (
            <AdminTable headers={['Title', 'Author', 'Categories', 'Date', 'Actions']}>
              {list.data.items.length === 0 && (
                <tr>
                  <td colSpan={5} className="hk-empty">
                    No articles yet.
                  </td>
                </tr>
              )}
              {list.data.items.map((item) => (
                <tr key={item.id} data-testid={`news-row-${item.id}`}>
                  <td>{item.title}</td>
                  <td>{item.author}</td>
                  <td>{item.categories}</td>
                  <td>{formatListDate(item.time)}</td>
                  <td className="hk-actions">
                    <button type="button" onClick={() => startEdit(item)}>
                      Edit
                    </button>{' '}
                    <button
                      type="button"
                      className="hk-secondary"
                      onClick={() => void onDelete(item)}
                      data-testid={`news-delete-${item.id}`}
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
        <form className="hk-form" onSubmit={(e) => void onSubmit(e)} data-testid="news-form">
          <TextField
            id="title"
            label="Title"
            value={form.title}
            onChange={(v) => set('title', v)}
            error={fieldErrors.title}
            maxLength={255}
          />
          <TextField
            id="summary"
            label="Summary"
            value={form.summary}
            onChange={(v) => set('summary', v)}
            error={fieldErrors.summary}
            multiline
          />
          <TextField
            id="story"
            label="Story"
            value={form.story}
            onChange={(v) => set('story', v)}
            error={fieldErrors.story}
            multiline
          />
          <TextField
            id="author"
            label="Author"
            value={form.author}
            onChange={(v) => set('author', v)}
            error={fieldErrors.author}
            maxLength={100}
          />
          <TextField
            id="categories"
            label="Categories"
            value={form.categories}
            onChange={(v) => set('categories', v)}
            error={fieldErrors.categories}
            hint="Comma separated, as stored in phpretro_news.categories."
            maxLength={255}
          />
          <TextField
            id="images"
            label="Image URLs"
            value={form.images}
            onChange={(v) => set('images', v)}
            error={fieldErrors.images}
            multiline
          />
          <Field
            id="time"
            label="Published at"
            hint="Leave blank to use the current time."
          >
            <input
              id="time"
              name="time"
              type="datetime-local"
              value={toLocalInput(form.time)}
              onChange={(e) => set('time', toEpoch(e.target.value))}
            />
          </Field>

          <div className="hk-actions">
            <button type="submit" disabled={saving} data-testid="news-save">
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
