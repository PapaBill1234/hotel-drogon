import type { ReactNode } from 'react';

/**
 * Shared presentational pieces for the converted housekeeping screens.
 *
 * These exist so the six resource pages render one consistent panel: the legacy
 * pages each repeated `<div class="page_title">…</div><div class="page_main">…`
 * with the notice box inline, and six copies of that in JSX would drift.
 */

/** The page title strip plus the content wrapper, mirroring `page_title`/`page_main`. */
export function AdminPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <div className="hk-page-title" data-testid="page-title">
        {title}
      </div>
      <div className="hk-content">{children}</div>
    </>
  );
}

/**
 * The legacy `clean-ok` notice box. `tone` distinguishes a saved-change
 * confirmation from a rejection; the legacy panel had only the green form.
 */
export function AdminNotice({
  children,
  tone = 'ok',
  testId,
}: {
  children: ReactNode;
  tone?: 'ok' | 'error';
  testId?: string;
}) {
  const cls = tone === 'error' ? 'hk-notice hk-notice-error' : 'hk-notice';
  return (
    <div className={cls} data-testid={testId}>
      {children}
    </div>
  );
}

/**
 * Visible warning for raw-markup (high-trust) fields.
 *
 * The plan requires "a visible warning in the admin UI" for raw-HTML/script
 * fields, in addition to the server-side capability gate. This is that warning;
 * it never renders the value itself, and callers must never place raw markup
 * into `dangerouslySetInnerHTML` anywhere in this panel.
 */
export function HighTrustWarning({ children }: { children?: ReactNode }) {
  return (
    <div className="hk-warning" data-testid="high-trust-warning">
      <strong>High-trust field: raw HTML/script</strong>
      {children ?? (
        <>
          This value is rendered by the public pages <em>without escaping</em>. Anyone
          who can write here can run script in visitors&apos; browsers. Editing it
          requires the high-trust content permission (staff rank 7+).
        </>
      )}
    </div>
  );
}

/** Form row with a label, and the server's message when the server rejected this field. */
export function Field({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="hk-field">
      <label htmlFor={id}>{label}</label>
      {children}
      {hint !== undefined && <div className="hk-field-error">{hint}</div>}
      {error !== undefined && (
        <div className="hk-field-error" data-testid={`field-error-${id}`}>
          {error}
        </div>
      )}
    </div>
  );
}

/** Text input / textarea / number input bound to a controlled string value. */
export function TextField({
  id,
  label,
  value,
  onChange,
  error,
  multiline = false,
  code = false,
  type = 'text',
  hint,
  maxLength,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  error?: string;
  multiline?: boolean;
  code?: boolean;
  type?: 'text' | 'number';
  hint?: ReactNode;
  maxLength?: number;
}) {
  const invalid = error !== undefined ? ' hk-invalid' : '';
  return (
    <Field id={id} label={label} error={error} hint={hint}>
      {multiline ? (
        <textarea
          id={id}
          name={id}
          className={code ? `hk-code${invalid}` : invalid.trim()}
          value={value}
          maxLength={maxLength}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          id={id}
          name={id}
          type={type}
          className={invalid.trim()}
          value={value}
          maxLength={maxLength}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </Field>
  );
}

/** `<label><input type="checkbox">Text</label>`, the legacy "Visible"/"Active" row. */
export function CheckField({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="hk-check">
      <input
        id={id}
        name={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <label htmlFor={id}>{label}</label>
    </div>
  );
}

/** A plain table with the given column headers. */
export function AdminTable({ headers, children }: { headers: string[]; children: ReactNode }) {
  return (
    <table>
      <thead>
        <tr>
          {headers.map((header) => (
            <th key={header}>{header}</th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}
