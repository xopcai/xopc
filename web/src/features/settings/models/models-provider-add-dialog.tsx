import * as Dialog from '@radix-ui/react-dialog';
import { AlertCircle, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { SETTINGS_SHELL_CONTENT_Z, SETTINGS_SHELL_OVERLAY_Z } from '@/lib/settings-shell-dialog-layer';
import { type ModelsSettingsMessages } from '@/i18n/messages';

import {
  API_TYPE_OPTIONS,
  type ApiType,
  type ProviderConfig,
} from '../models-json-api';

import {
  inputClassName,
  PROVIDER_PRESETS,
  providerIdForPreset,
  selectClassName,
} from './models-settings-lib';

type ProviderDialogProps = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  presetKey?: string | null;
  onConfirm: (providerId: string, prov: ProviderConfig) => void;
  m: ModelsSettingsMessages;
};

export function ProviderAddDialog({ open, onOpenChange, presetKey, onConfirm, m }: ProviderDialogProps) {
  const [providerId, setProviderId] = useState('');
  const [preset, setPreset] = useState('custom');
  const [baseUrl, setBaseUrl] = useState('');
  const [api, setApi] = useState<ApiType>('openai-completions');
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    const pk = presetKey || null;
    if (pk && PROVIDER_PRESETS[pk]) {
      const p = PROVIDER_PRESETS[pk];
      setPreset(pk);
      setBaseUrl(p.baseUrl || '');
      setApi((p.api as ApiType) || 'openai-completions');
      setApiKey(p.apiKey ?? '');
      setProviderId(providerIdForPreset(pk));
    } else {
      setPreset('custom');
      setProviderId('');
      setBaseUrl('');
      setApi('openai-completions');
      setApiKey('');
    }
  }, [open, presetKey]);

  const applyPreset = (key: string) => {
    setPreset(key);
    if (key === 'custom') return;
    const p = PROVIDER_PRESETS[key];
    if (!p) return;
    setBaseUrl(p.baseUrl || '');
    setApi((p.api as ApiType) || 'openai-completions');
    setApiKey(p.apiKey ?? '');
    setProviderId(providerIdForPreset(key));
  };

  const handleSubmit = () => {
    const id = providerId.trim();
    if (!id) {
      setError(m.providerIdRequired);
      return;
    }
    setError(null);
    onConfirm(id, {
      baseUrl: baseUrl.trim() || undefined,
      api,
      apiKey: apiKey.trim() || undefined,
      models: [],
    });
    onOpenChange(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          className={cn('xopc-dialog-overlay fixed inset-0 bg-scrim', SETTINGS_SHELL_OVERLAY_Z)}
        />
        <Dialog.Content
          className={cn(
            'xopc-dialog-content fixed left-1/2 top-1/2 max-h-[min(90vh,640px)] w-[min(100%-2rem,32rem)] -translate-x-1/2 -translate-y-1/2',
            SETTINGS_SHELL_CONTENT_Z,
            'overflow-y-auto rounded-xl border border-edge bg-surface-panel p-4 shadow-popover dark:border-edge',
          )}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="mb-3 flex items-start justify-between gap-2">
            <div>
              <Dialog.Title className="text-base font-semibold text-fg">{m.addProviderTitle}</Dialog.Title>
              <p className="mt-0.5 text-xs text-fg-muted">{m.addProviderSubtitle}</p>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="rounded-lg p-1.5 text-fg-muted hover:bg-surface-base hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                aria-label={m.close}
              >
                <X className="size-4" />
              </button>
            </Dialog.Close>
          </div>

          <div className="flex flex-col gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-fg-muted">{m.presetLabel}</label>
              <select
                className={selectClassName()}
                value={preset}
                onChange={(e) => applyPreset(e.target.value)}
              >
                <option value="custom">{m.presetCustom}</option>
                <option value="ollama">{m.presetOllama}</option>
                <option value="lmstudio">{m.presetLmStudio}</option>
                <option value="openrouter">{m.presetOpenRouter}</option>
                <option value="zhipuCn">{m.presetZhipuCn}</option>
                <option value="zaiGeneral">{m.presetZaiGeneral}</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-fg">
                {m.providerIdLabel}
                <span className="text-red-600 dark:text-red-400"> *</span>
              </label>
              <input
                className={inputClassName()}
                value={providerId}
                onChange={(e) => setProviderId(e.target.value)}
                placeholder={m.providerIdPlaceholder}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-fg-muted">{m.baseUrl}</label>
                <input
                  className={inputClassName()}
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://…"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-fg-muted">{m.apiType}</label>
                <select
                  className={selectClassName()}
                  value={api}
                  onChange={(e) => setApi(e.target.value as ApiType)}
                >
                  {API_TYPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-fg-muted">{m.apiKey}</label>
              <input
                className={inputClassName()}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={m.apiKeyPlaceholder}
              />
            </div>
            {error ? (
              <p className="flex items-center gap-1 text-xs text-red-600 dark:text-red-400">
                <AlertCircle className="size-3.5 shrink-0" />
                {error}
              </p>
            ) : null}
          </div>

          <div className="mt-4 flex justify-end gap-2 border-t border-edge-subtle pt-3 dark:border-edge">
            <Dialog.Close asChild>
              <Button type="button" variant="secondary">
                {m.cancel}
              </Button>
            </Dialog.Close>
            <Button type="button" className="bg-accent text-white hover:bg-accent/90" onClick={handleSubmit}>
              {m.addProviderConfirm}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
