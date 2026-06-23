import { Loader2 } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { FieldLabel } from '@/features/settings/channels/field-primitives';
import {
  VoiceApiKeyField,
  type VoiceApiKeyFieldLabels,
} from '@/features/settings/voice-api-key-field';
import {
  fetchVoiceSettings,
  fetchVoiceSttProviders,
  patchVoiceSettings,
  type VoiceSettingsState,
} from '@/features/settings/voice-config-api';
import { nativeSelectMaxWidthClass, selectControlBaseClass, settingsInputFocusClass } from '@/lib/form-field-width';
import { cn } from '@/lib/cn';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { showToast } from '@/lib/toast';
import { messages } from '@/i18n/messages';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

const GROQ_MODELS = [
  { id: 'whisper-large-v3-turbo', name: 'Whisper Large v3 Turbo' },
  { id: 'whisper-large-v3', name: 'Whisper Large v3' },
] as const;

type ExtensionDetailResponse = {
  manifest?: {
    mediaUnderstandingProviders?: string[];
    contracts?: { mediaUnderstandingProviders?: string[] };
  };
};

function resolveMediaProviderId(detail: ExtensionDetailResponse | undefined): string | undefined {
  const primary = detail?.manifest?.mediaUnderstandingProviders?.[0];
  if (typeof primary === 'string' && primary.trim()) {
    return primary.trim();
  }
  const contract = detail?.manifest?.contracts?.mediaUnderstandingProviders?.[0];
  if (typeof contract === 'string' && contract.trim()) {
    return contract.trim();
  }
  return undefined;
}

function selectClassName(): string {
  return cn(selectControlBaseClass, nativeSelectMaxWidthClass);
}

function inputClassName(): string {
  return cn(
    'w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg',
    'placeholder:text-fg-subtle',
    settingsInputFocusClass,
    'dark:border-edge',
  );
}

type SttCredSlice = { apiKey: string; model: string };

function savedSliceFromVoiceSettings(
  voiceSettings: VoiceSettingsState | undefined,
  providerId: string | undefined,
): SttCredSlice {
  if (!voiceSettings || !providerId) return { apiKey: '', model: GROQ_MODELS[0].id };
  if (providerId === 'alibaba') {
    return {
      apiKey: voiceSettings.stt.alibaba?.apiKey ?? '',
      model: voiceSettings.stt.alibaba?.model ?? 'paraformer-v2',
    };
  }
  if (providerId === 'openai') {
    return {
      apiKey: voiceSettings.stt.openai?.apiKey ?? '',
      model: voiceSettings.stt.openai?.model ?? 'whisper-1',
    };
  }
  const slice = voiceSettings.stt.providers?.[providerId];
  return {
    apiKey: typeof slice?.apiKey === 'string' ? slice.apiKey : '',
    model: typeof slice?.model === 'string' ? slice.model : GROQ_MODELS[0].id,
  };
}

function ExtensionSttProviderSettingsBody({
  providerId,
  voiceSettings,
  mutateVoice,
}: {
  providerId: string;
  voiceSettings: VoiceSettingsState;
  mutateVoice: ReturnType<typeof useSWR<VoiceSettingsState>>['mutate'];
}) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const v = m.voiceSettings;
  const xs = m.extensionSttMedia;
  const apiKeyLabels: VoiceApiKeyFieldLabels = {
    maskedHelp: v.apiKeyMaskedHelp,
    copy: v.apiKeyCopy,
    copied: v.apiKeyCopied,
    show: v.apiKeyShow,
    hide: v.apiKeyHide,
    notInConfigFile: v.apiKeyNotInConfigFile,
    loadFailed: v.apiKeyRevealFailed,
  };

  const { data: sttProviders } = useSWR(
    apiUrl('/api/voice/stt-providers'),
    fetchVoiceSttProviders,
    { revalidateOnFocus: false },
  );

  const configured = useMemo(
    () => sttProviders?.providers.some((p) => p.id === providerId && p.configured) ?? false,
    [providerId, sttProviders],
  );

  const savedSlice = useMemo(
    () => savedSliceFromVoiceSettings(voiceSettings, providerId),
    [providerId, voiceSettings],
  );

  const dirtyRef = useRef(false);
  const [localDraft, setLocalDraft] = useState<SttCredSlice | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [_savedFlash, setSavedFlash] = useState(false);

  const credDraft = localDraft ?? savedSlice;
  const credBaseline = savedSlice;

  const dirty =
    credDraft.apiKey !== credBaseline.apiKey || credDraft.model !== credBaseline.model;

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const next: VoiceSettingsState = structuredClone(voiceSettings);
      next.stt.enabled = true;
      if (providerId === 'alibaba') {
        next.stt.provider = 'alibaba';
        next.stt.alibaba = { ...next.stt.alibaba, apiKey: credDraft.apiKey, model: credDraft.model };
      } else if (providerId === 'openai') {
        next.stt.provider = 'openai';
        next.stt.openai = { ...next.stt.openai, apiKey: credDraft.apiKey, model: credDraft.model };
      } else {
        next.stt.providers = {
          ...(next.stt.providers ?? {}),
          [providerId]: {
            ...(next.stt.providers?.[providerId] ?? {}),
            apiKey: credDraft.apiKey,
            model: credDraft.model,
          },
        };
        if (!next.stt.provider || next.stt.provider === 'alibaba' || next.stt.provider === 'openai') {
          next.stt.provider = providerId;
        }
      }
      await patchVoiceSettings(next);
      await mutateVoice(next, false);
      dirtyRef.current = false;
      setLocalDraft(null);
      setSavedFlash(true);
      showToast({ type: 'success', title: v.saved });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [credDraft.apiKey, credDraft.model, mutateVoice, providerId, voiceSettings]);

  const modelOptions = providerId === 'groq' ? GROQ_MODELS : [{ id: credDraft.model, name: credDraft.model }];

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-edge bg-surface-base p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-fg">{xs.credentialsTitle}</h2>
          <p className="mt-1 text-xs text-fg-muted">
            {xs.credentialsHint.replace('{providerId}', providerId)}
          </p>
        </div>
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-xs font-medium',
            configured
              ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
              : 'bg-amber-500/10 text-amber-800 dark:text-amber-200',
          )}
        >
          {configured ? xs.configured : xs.notConfigured}
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className={cn('flex flex-col gap-1.5', nativeSelectMaxWidthClass)}>
          <FieldLabel>{v.stt.apiKey}</FieldLabel>
          <VoiceApiKeyField
            kind="stt"
            providerId={providerId}
            fieldId={`ext-stt-${providerId}-api-key`}
            value={credDraft.apiKey}
            onChange={(next) => {
              dirtyRef.current = true;
              setLocalDraft((prev) => {
                const base = prev ?? savedSlice;
                return { ...base, apiKey: next };
              });
              setError(null);
            }}
            labels={apiKeyLabels}
            placeholder={providerId === 'groq' ? 'gsk_...' : 'sk-...'}
          />
          <p className="text-xs text-fg-subtle">
            {v.stt.apiKeyDesc}
            {providerId === 'groq' ? ' (GROQ_API_KEY)' : ''}
          </p>
        </div>
        <div className={cn('flex flex-col gap-1.5', nativeSelectMaxWidthClass)}>
          <FieldLabel>{v.stt.model}</FieldLabel>
          {providerId === 'groq' ? (
            <select
              className={selectClassName()}
              value={credDraft.model}
              onChange={(e) => {
                dirtyRef.current = true;
                setLocalDraft((prev) => {
                  const base = prev ?? savedSlice;
                  return { ...base, model: e.target.value };
                });
                setError(null);
              }}
            >
              {modelOptions.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
          ) : (
            <input
              className={inputClassName()}
              value={credDraft.model}
              onChange={(e) => {
                dirtyRef.current = true;
                setLocalDraft((prev) => {
                  const base = prev ?? savedSlice;
                  return { ...base, model: e.target.value };
                });
                setError(null);
              }}
            />
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {error ? <span className="text-xs text-red-600 dark:text-red-400">{error}</span> : null}
        <Button
          type="button"
          variant="ghost"
          className="h-8 text-xs"
          disabled={!dirty || saving}
          onClick={() => {
            dirtyRef.current = false;
            setLocalDraft(null);
            setError(null);
          }}
        >
          {v.discard}
        </Button>
        <Button
          type="button"
          variant="primary"
          className="h-8 text-xs"
          disabled={!dirty || saving}
          onClick={() => void handleSave()}
        >
          {saving ? v.saving : v.save}
        </Button>
      </div>
    </div>
  );
}

export function ExtensionSttProviderSettings({ extensionId }: { extensionId: string }) {
  const language = useLocaleStore((s) => s.language);
  const hasToken = useGatewayStore((s) => Boolean(s.token));

  const { data: detail, isLoading: detailLoading } = useSWR(
    hasToken && extensionId ? `ext-stt-detail-${extensionId}` : null,
    () => fetchJson<ExtensionDetailResponse>(apiUrl(`/api/extensions/${encodeURIComponent(extensionId)}`)),
  );

  const providerId = resolveMediaProviderId(detail);

  const {
    data: voiceSettings,
    mutate: mutateVoice,
    isLoading: voiceLoading,
  } = useSWR(hasToken ? 'voice-settings-ext-stt' : null, fetchVoiceSettings, {
    revalidateOnFocus: false,
  });

  if (!hasToken) {
    return null;
  }

  if (detailLoading || voiceLoading) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-fg-muted">
        <Loader2 className="size-4 animate-spin" />
        …
      </div>
    );
  }

  if (!providerId) {
    return (
      <p className="text-sm text-fg-muted">
        {language === 'zh'
          ? '该扩展未声明 mediaUnderstandingProviders。'
          : 'This extension does not declare mediaUnderstandingProviders.'}
      </p>
    );
  }

  if (!voiceSettings) {
    return null;
  }

  return (
    <ExtensionSttProviderSettingsBody
      key={`${extensionId}:${providerId}`}
      providerId={providerId}
      voiceSettings={voiceSettings}
      mutateVoice={mutateVoice}
    />
  );
}
