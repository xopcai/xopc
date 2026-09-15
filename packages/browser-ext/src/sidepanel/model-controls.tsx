import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import type { BrowserConfiguredModel, BrowserSessionModelConfig } from './chat-client';

function thinkingLabel(level: string) {
  return t(`thinking${level[0].toUpperCase()}${level.slice(1)}`);
}

export function ModelControls({ models, config, disabled, onModel, onThinking }: {
  models: BrowserConfiguredModel[];
  config?: BrowserSessionModelConfig;
  disabled: boolean;
  onModel: (id: string) => Promise<void>;
  onThinking: (level: string) => Promise<void>;
}) {
  const details = useRef<HTMLDetailsElement>(null);
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const selected = models.find(model => model.id === config?.model);
  const filtered = models.filter(model => `${model.name} ${model.id}`.toLowerCase().includes(query.toLowerCase()));
  useEffect(() => {
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (details.current && ((event instanceof KeyboardEvent && event.key === 'Escape') || (event instanceof MouseEvent && !details.current.contains(event.target as Node)))) details.current.open = false;
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, []);
  async function update(action: () => Promise<void>) {
    if (saving || disabled) return;
    setSaving(true); setError('');
    try { await action(); }
    catch (cause) { setError(String(cause)); }
    finally { setSaving(false); }
  }
  return <details className="model-picker" ref={details}>
    <summary aria-label={t('sessionModel')}>{selected?.name ?? config?.model ?? t('model')}{config?.thinkingLevel ? ` · ${thinkingLabel(config.thinkingLevel)}` : ''}</summary>
    <div className="model-picker-panel">
      <input aria-label={t('searchModels')} placeholder={t('searchModels')} value={query} onChange={event => setQuery(event.target.value)} />
      <div className="model-picker-list">
        {filtered.map(model => <button type="button" key={model.id} disabled={disabled || saving} aria-pressed={model.id === config?.model} onClick={() => void update(() => onModel(model.id))}>
          <strong>{model.name}</strong><small>{model.id}</small>
        </button>)}
        {!filtered.length ? <p>{t('noMatchingModels')}</p> : null}
      </div>
      {selected?.thinking?.options?.length ? <fieldset disabled={disabled || saving}>
        <legend>{t('thinkingLevel')}</legend>
        {selected.thinking.options.map(level => <button type="button" key={level} aria-pressed={config?.thinkingLevel === level} onClick={() => void update(() => onThinking(level))}>{thinkingLabel(level)}</button>)}
      </fieldset> : null}
      {error ? <p role="alert">{error}</p> : null}
    </div>
  </details>;
}
