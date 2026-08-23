import { useCallback, useMemo, useRef, useState } from 'react';
import useSWR from 'swr';

import { AutosaveStatus } from '@/components/ui/autosave-status';
import { FieldLabel } from '@/features/settings/channels/field-primitives';
import { SettingsPanelSkeleton } from '@/features/settings/settings-loading-skeleton';
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
import { selectFieldMaxWidthClass, selectTriggerClass, settingsInputFocusClass } from '@/lib/form-field-width';
import { cn } from '@/lib/cn';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { messages } from '@/i18n/messages';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';
import { Select, SelectOption } from '@/components/ui/popover-select';
import { useAutosave } from '@/lib/use-autosave';

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
  return cn(selectTriggerClass, selectFieldMaxWidthClass);
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
  defaultModel: string,
): SttCredSlice {
  if (!voiceSettings || !providerId) return { apiKey: '', model: defaultModel };
  const slice = voiceSettings.stt.providers?.[providerId];
  return {
    apiKey: typeof slice?.apiKey === 'string' ? slice.apiKey : '',
    model: typeof slice?.model === 'string' ? slice.model : defaultModel,
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

  const providerMetadata = useMemo(
    () => sttProviders?.providers.find((provider) => provider.id === providerId),
    [providerId, sttProviders],
  );
  const configured = providerMetadata?.configured ?? false;
  const modelOptions = providerMetadata?.models ?? [];
  const defaultModel = modelOptions[0]?.id
    ?? providerMetadata?.fields.find((field) => field.key === 'model')?.defaultValue
    ?? '';

  const savedSlice = useMemo(
    () => savedSliceFromVoiceSettings(voiceSettings, providerId, defaultModel),
    [defaultModel, providerId, voiceSettings],
  );

  const dirtyRef = useRef(false);
  const [localDraft, setLocalDraft] = useState<SttCredSlice | null>(null);

  const credDraft = localDraft ?? savedSlice;
  const draftRef = useRef(credDraft);
  draftRef.current = credDraft;
  const credBaseline = savedSlice;

  const dirty =
    credDraft.apiKey !== credBaseline.apiKey || credDraft.model !== credBaseline.model;

  const handleSave = useCallback(async (snapshot: SttCredSlice) => {
      const next: VoiceSettingsState = structuredClone(voiceSettings);
      next.stt.enabled = true;
      next.stt.provider = providerId;
      next.stt.providers = {
        ...(next.stt.providers ?? {}),
        [providerId]: {
          ...(next.stt.providers?.[providerId] ?? {}),
          apiKey: snapshot.apiKey,
          model: snapshot.model,
        },
      };
      await patchVoiceSettings(next);
      await mutateVoice(next, false);
      dirtyRef.current = JSON.stringify(draftRef.current) !== JSON.stringify(snapshot);
      setLocalDraft((current) => current && JSON.stringify(current) === JSON.stringify(snapshot) ? null : current);
  }, [mutateVoice, providerId, voiceSettings]);

  const autosave = useAutosave({ value: credDraft, dirty, onSave: handleSave });

  const displayedModelOptions = modelOptions.length > 0
    ? modelOptions
    : credDraft.model
      ? [{ id: credDraft.model, name: credDraft.model }]
      : [];

  return (
    <div className="flex flex-col gap-4 rounded-xl bg-surface-base p-4" onBlurCapture={autosave.onBlurCapture}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-fg">{xs.credentialsTitle}</h2>
          <p className="mt-1 text-xs text-fg-muted">
            {xs.credentialsHint.replace('{providerId}', providerId)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AutosaveStatus status={autosave.status} error={autosave.error} />
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
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className={cn('flex flex-col gap-1.5', selectFieldMaxWidthClass)}>
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
            }}
            labels={apiKeyLabels}
            placeholder={providerId === 'groq' ? 'gsk_...' : 'sk-...'}
          />
          <p className="text-xs text-fg-subtle">
            {v.stt.apiKeyDesc}
            {providerId === 'groq' ? ' (GROQ_API_KEY)' : ''}
          </p>
        </div>
        <div className={cn('flex flex-col gap-1.5', selectFieldMaxWidthClass)}>
          <FieldLabel>{v.stt.model}</FieldLabel>
          {displayedModelOptions.length > 0 ? (
            <Select
              className={selectClassName()}
              value={credDraft.model}
              onChange={(e) => {
                dirtyRef.current = true;
                setLocalDraft((prev) => {
                  const base = prev ?? savedSlice;
                  return { ...base, model: e.target.value };
                });
                autosave.saveNow({ ...credDraft, model: e.target.value });
              }}
            >
              {displayedModelOptions.map((entry) => (
                <SelectOption key={entry.id} value={entry.id}>
                  {entry.name}
                </SelectOption>
              ))}
            </Select>
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
              }}
            />
          )}
        </div>
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
    return <SettingsPanelSkeleton rows={2} />;
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
