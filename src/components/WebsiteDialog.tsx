import { useEffect, useRef, useState, type FormEvent } from 'react';
import { websiteFromExplicit } from '../domain/websites';

export function WebsiteDialog({
  mode,
  initialUrl,
  initialTitle,
  readOnly,
  onCancel,
  onSubmit,
}: {
  mode: 'create' | 'edit';
  initialUrl: string;
  initialTitle: string;
  readOnly: boolean;
  onCancel: () => void;
  onSubmit: (url: string, title: string) => void;
}) {
  const [url, setUrl] = useState(initialUrl);
  const [title, setTitle] = useState(initialTitle);
  const [error, setError] = useState('');
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => {
    first.current?.focus();
    first.current?.select();
  }, []);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (readOnly) return;
    const parsed = websiteFromExplicit(url, title);
    if (!parsed.ok) {
      setError(parsed.message);
      return;
    }
    onSubmit(parsed.url, parsed.title);
  }

  return (
    <div className="password-layer">
      <form
        className="password-dialog website-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={mode === 'create' ? 'Add website' : 'Edit website'}
        onSubmit={submit}
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key !== 'Escape') return;
          event.preventDefault();
          onCancel();
        }}
      >
        <p className="menu-label">{mode === 'create' ? 'Add website' : 'Edit website'}</p>
        <label>
          Website URL
          <input
            ref={first}
            type="text"
            name="url"
            autoComplete="off"
            spellCheck={false}
            aria-label="Website URL"
            value={url}
            disabled={readOnly}
            onChange={(event) => {
              setUrl(event.target.value);
              setError('');
            }}
          />
        </label>
        <label>
          Title
          <input
            type="text"
            name="title"
            autoComplete="off"
            aria-label="Website title"
            placeholder="Optional"
            value={title}
            disabled={readOnly}
            onChange={(event) => {
              setTitle(event.target.value);
              setError('');
            }}
          />
        </label>
        {error ? <p className="password-error" role="alert">{error}</p> : null}
        <div className="password-actions">
          <button type="submit" aria-label={mode === 'create' ? 'Add website' : 'Save website'} disabled={readOnly}>{mode === 'create' ? 'Add' : 'Save'}</button>
          <button type="button" aria-label="Cancel" onClick={onCancel}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
