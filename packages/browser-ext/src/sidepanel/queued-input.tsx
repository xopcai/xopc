import { useState } from 'react';
import { t } from '../i18n';

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function QueuedInput({ input, onSave, onCancel }: {
  input: { id: string; content: string; version: number };
  onSave: (content: string, version: number) => Promise<void>;
  onCancel: () => Promise<void>;
}) {
  const [edit, setEdit] = useState<{ content: string; version: number }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await action();
      setEdit(undefined);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="queued-input">
      <div className="composer-notice queued-notice">
        {edit ? (
          <input
            aria-label={t('editQueuedMessage')}
            value={edit.content}
            disabled={busy}
            autoFocus
            onChange={event => setEdit({ ...edit, content: event.target.value })}
            onKeyDown={event => {
              if (event.key === 'Escape') {
                event.preventDefault();
                setEdit(undefined);
                return;
              }
              if (event.key === 'Enter') {
                event.preventDefault();
                if (!event.nativeEvent.isComposing && edit.content.trim()) {
                  void run(() => onSave(edit.content, edit.version));
                }
              }
            }}
          />
        ) : (
          <span>
            <strong className="queued-tag">{t('queued')}</strong>
            {' · '}
            {input.content || t('attachment')}
          </span>
        )}
        <div className="queued-actions">
          {edit ? (
            <>
              <button
                type="button"
                className="queued-save"
                disabled={busy || !edit.content.trim()}
                onClick={() => void run(() => onSave(edit.content, edit.version))}
              >
                {t('saveQueuedMessage')}
              </button>
              <button type="button" disabled={busy} onClick={() => setEdit(undefined)}>
                {t('cancelQueuedMessage')}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => setEdit({ content: input.content, version: input.version })}
              >
                {t('editQueuedMessage')}
              </button>
              <button type="button" disabled={busy} onClick={() => void run(onCancel)}>
                {t('cancelQueuedMessage')}
              </button>
            </>
          )}
        </div>
      </div>
      {error ? <div className="composer-error" role="alert">{error}</div> : null}
    </div>
  );
}
