import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import type { BrowserConfiguredModel, BrowserSessionModelConfig } from './chat-client';
import { CheckIcon, ChevronDownIcon, CloseIcon, SearchIcon } from './icons';

function thinkingLabel(level: string) {
  return t(`thinking${level[0].toUpperCase()}${level.slice(1)}`);
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
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
  const needle = query.trim().toLowerCase();
  const filtered = needle
    ? models.filter(model => `${model.name} ${model.id} ${model.provider ?? ''}`.toLowerCase().includes(needle))
    : models;

  useEffect(() => {
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (details.current && (
        (event instanceof KeyboardEvent && event.key === 'Escape')
        || (event instanceof MouseEvent && !details.current.contains(event.target as Node))
      )) {
        details.current.open = false;
      }
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, []);

  async function update(action: () => Promise<void>, closeAfter = false) {
    if (saving || disabled) return;
    setSaving(true);
    setError('');
    try {
      await action();
      if (closeAfter && details.current) details.current.open = false;
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <details className="model-picker" ref={details}>
      <summary aria-label={t('sessionModel')}>
        <span className="model-picker-label">
          {selected?.name ?? (config?.model || t('model'))}
          {config?.thinkingLevel && config.thinkingLevel !== 'off' ? ` · ${thinkingLabel(config.thinkingLevel)}` : ''}
        </span>
        <ChevronDownIcon className="model-picker-chevron" />
      </summary>
      <div className="model-picker-panel">
        <div className="model-picker-search">
          <SearchIcon />
          <input
            aria-label={t('searchModels')}
            placeholder={t('searchModels')}
            value={query}
            onChange={event => setQuery(event.target.value)}
          />
          {query ? (
            <button type="button" className="model-search-clear" aria-label={t('clearSearch')} onClick={() => setQuery('')}>
              <CloseIcon />
            </button>
          ) : null}
        </div>
        <div className="model-picker-list">
          {filtered.map(model => {
            const active = model.id === config?.model;
            return (
              <button
                type="button"
                key={model.id}
                disabled={disabled || saving}
                aria-pressed={active}
                onClick={() => void update(() => onModel(model.id))}
              >
                <span className="model-picker-item-copy">
                  <strong>
                    {model.name}
                    {model.recommended ? <span className="model-badge">{t('clarifyRecommended')}</span> : null}
                  </strong>
                  <small>{model.id}</small>
                </span>
                {active ? <CheckIcon className="model-picker-check" /> : null}
              </button>
            );
          })}
          {!filtered.length ? <p className="model-picker-empty">{t('noMatchingModels')}</p> : null}
        </div>
        {selected?.thinking?.options?.length ? (
          <fieldset disabled={disabled || saving}>
            <legend>{t('thinkingLevel')}</legend>
            <div className="thinking-options">
              {selected.thinking.options.map(level => (
                <button
                  type="button"
                  key={level}
                  aria-pressed={config?.thinkingLevel === level}
                  onClick={() => void update(() => onThinking(level))}
                >
                  {thinkingLabel(level)}
                </button>
              ))}
            </div>
          </fieldset>
        ) : null}
        {error ? <p className="model-picker-error" role="alert">{error}</p> : null}
      </div>
    </details>
  );
}
