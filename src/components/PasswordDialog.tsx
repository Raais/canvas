import { useEffect, useRef, useState, type FormEvent } from 'react';

export function PasswordDialog({
  mode,
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  mode: 'protect' | 'unlock';
  busy: boolean;
  error: string;
  onCancel: () => void;
  onSubmit: (password: string, confirm: string) => void;
}) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => {
    first.current?.focus();
  }, []);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!busy) onSubmit(password, confirm);
  }

  return (
    <div className="password-layer">
      <form
        className="password-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={mode === 'protect' ? 'Password protect' : 'Unlock'}
        onSubmit={submit}
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key !== 'Escape') return;
          event.preventDefault();
          onCancel();
        }}
      >
        <p className="menu-label">{mode === 'protect' ? 'Password protect' : 'Unlock'}</p>
        <label>
          Password
          <input
            ref={first}
            type="password"
            autoComplete={mode === 'protect' ? 'new-password' : 'current-password'}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {mode === 'protect' ? (
          <label>
            Confirm password
            <input
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
            />
          </label>
        ) : null}
        {mode === 'protect' ? <p className="project-note">If you forget this password, the note cannot be recovered.</p> : null}
        {error ? <p className="password-error" role="alert">{error}</p> : null}
        <div className="password-actions">
          <button type="submit" disabled={busy}>{mode === 'protect' ? 'Protect' : 'Unlock'}</button>
          <button type="button" onClick={onCancel} disabled={busy}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
