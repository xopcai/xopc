import * as Dialog from '@radix-ui/react-dialog';
import { AlertCircle, X } from 'lucide-react';
import { useReducer, useRef } from 'react';

import { Button } from '@/components/ui/button';
import { SecretInput } from '@/components/ui/secret-input';
import { cn } from '@/lib/cn';
import { DEFAULT_SECRET_INPUT_LABELS } from '@/lib/secret-input-labels';
import { ghostIconButton } from '@/lib/interaction';
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

type FormState = {
  providerId: string;
  preset: string;
  baseUrl: string;
  api: ApiType;
  apiKey: string;
  error: string | null;
};

function formStateFromPreset(presetKey?: string | null): FormState {
  const pk = presetKey || null;
  if (pk && PROVIDER_PRESETS[pk]) {
    const p = PROVIDER_PRESETS[pk];
    return {
      preset: pk,
      baseUrl: p.baseUrl || '',
      api: (p.api as ApiType) || 'openai-completions',
      apiKey: p.apiKey ?? '',
      providerId: providerIdForPreset(pk),
      error: null,
    };
  }
  return {
    preset: 'custom',
    providerId: '',
    baseUrl: '',
    api: 'openai-completions',
    apiKey: '',
    error: null,
  };
}

type FormAction =
  | { type: 'reset'; presetKey?: string | null }
  | { type: 'applyPreset'; key: string }
  | { type: 'setProviderId'; value: string }
  | { type: 'setBaseUrl'; value: string }
  | { type: 'setApi'; value: ApiType }
  | { type: 'setApiKey'; value: string }
  | { type: 'setError'; value: string | null };

function formReducer(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case 'reset':
      return formStateFromPreset(action.presetKey);
    case 'applyPreset': {
      if (action.key === 'custom') {
        return { ...state, preset: 'custom', error: null };
      }
      const p = PROVIDER_PRESETS[action.key];
      if (!p) return state;
      return {
        ...state,
        preset: action.key,
        baseUrl: p.baseUrl || '',
        api: (p.api as ApiType) || 'openai-completions',
        apiKey: p.apiKey ?? '',
        providerId: providerIdForPreset(action.key),
        error: null,
      };
    }
    case 'setProviderId':
      return { ...state, providerId: action.value };
    case 'setBaseUrl':
      return { ...state, baseUrl: action.value };
    case 'setApi':
      return { ...state, api: action.value };
    case 'setApiKey':
      return { ...state, apiKey: action.value };
    case 'setError':
      return { ...state, error: action.value };
  }
}

export function ProviderAddDialog({ open, onOpenChange, presetKey, onConfirm, m }: ProviderDialogProps) {
  const [form, dispatch] = useReducer(formReducer, undefined as never, () => formStateFromPreset(presetKey));

  const dialogResetKey = open ? (presetKey ?? 'custom') : '';
  const trackedDialogResetKeyRef = useRef('');
  if (open && trackedDialogResetKeyRef.current !== dialogResetKey) {
    trackedDialogResetKeyRef.current = dialogResetKey;
    dispatch({ type: 'reset', presetKey });
  }
  if (!open && trackedDialogResetKeyRef.current !== '') {
    trackedDialogResetKeyRef.current = '';
  }

  const { providerId, preset, baseUrl, api, apiKey, error } = form;

  const handleSubmit = () => {
    const id = providerId.trim();
    if (!id) {
      dispatch({ type: 'setError', value: m.providerIdRequired });
      return;
    }
    dispatch({ type: 'setError', value: null });
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
                className={cn(ghostIconButton, 'p-1.5 hover:bg-surface-base')}
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
                onChange={(e) => dispatch({ type: 'applyPreset', key: e.target.value })}
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
                onChange={(e) => dispatch({ type: 'setProviderId', value: e.target.value })}
                placeholder={m.providerIdPlaceholder}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-fg-muted">{m.baseUrl}</label>
                <input
                  className={inputClassName()}
                  value={baseUrl}
                  onChange={(e) => dispatch({ type: 'setBaseUrl', value: e.target.value })}
                  placeholder="https://…"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-fg-muted">{m.apiType}</label>
                <select
                  className={selectClassName()}
                  value={api}
                  onChange={(e) => dispatch({ type: 'setApi', value: e.target.value as ApiType })}
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
              <SecretInput
                value={apiKey}
                onChange={(next) => dispatch({ type: 'setApiKey', value: next })}
                placeholder={m.apiKeyPlaceholder}
                labels={{ ...DEFAULT_SECRET_INPUT_LABELS, show: m.show, hide: m.hide }}
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
