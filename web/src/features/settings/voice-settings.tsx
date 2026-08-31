import { Loader2, Mic, Play, Square, Volume2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { AutosaveStatus } from '@/components/ui/autosave-status';
import { SecretInput } from '@/components/ui/secret-input';
import { useGatewayConfigSwr } from '@/features/gateway/gateway-config-swr';
import { SettingsPanelSkeleton } from '@/features/settings/settings-loading-skeleton';
import {
  fetchVoiceModels,
  fetchVoiceProviders,
  fetchVoiceSttProviders,
  fetchTtsVoices,
  fetchLocalVoiceStatus,
  installLocalVoiceModel,
  LOCAL_VOICE_MODEL_INSTALL_STARTED_EVENT,
  normalizeVoiceSettings,
  patchVoiceSettings,
  removeLocalVoiceModel,
  testTtsVoice,
  type SttProviderListEntry,
  type TtsProviderListEntry,
  type VoiceConfigFieldMetadata,
  type VoiceModelsPayload,
  type VoiceSettingsState,
  type LocalVoiceModelStatus,
} from '@/features/settings/voice-config-api';
import {
  VoiceApiKeyField,
  type VoiceApiKeyFieldLabels,
} from '@/features/settings/voice-api-key-field';
import { apiUrl } from '@/lib/url';
import { selectFieldMaxWidthClass, selectTriggerClass, settingsInputFocusClass } from '@/lib/form-field-width';
import { cn } from '@/lib/cn';
import { DEFAULT_SECRET_INPUT_LABELS } from '@/lib/secret-input-labels';
import { messages, type VoiceSettingsMessages } from '@/i18n/messages';
import { useAutosave } from '@/lib/use-autosave';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';
import { Select, SelectOption } from '@/components/ui/popover-select';

const credentialFieldWidthClass = selectFieldMaxWidthClass;

function inputClassName(): string {
  return cn(
    'w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg',
    'placeholder:text-fg-subtle',
    settingsInputFocusClass,
    'dark:border-edge',
  );
}

function selectClassName(): string {
  return cn(selectTriggerClass, selectFieldMaxWidthClass);
}

function audioBytesLabel(bytes: number | undefined): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function makeAudioUrl(base64: string, mimeType: string): string {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return URL.createObjectURL(new Blob([bytes], { type: mimeType }));
}

function sttProviderLabel(id: string, v: VoiceSettingsMessages): string {
  switch (id) {
    case 'xopc-local':
      return v.stt.localProvider;
    case 'openai':
      return v.stt.openai;
    case 'alibaba':
      return v.stt.alibaba;
    case 'groq':
      return 'Groq';
    default:
      return id;
  }
}

function ttsProviderLabel(id: string, v: VoiceSettingsMessages): string {
  switch (id) {
    case 'openai':
      return v.tts.providerOpenai;
    case 'alibaba':
      return v.stt.alibaba;
    case 'edge':
      return v.tts.providerEdge;
    case 'tts-local-cli':
      return v.tts.providerLocalCli;
    case 'minimax':
      return 'MiniMax';
    default:
      return id;
  }
}

function ttsTriggerLabel(trigger: VoiceSettingsState['tts']['trigger'], v: VoiceSettingsMessages): string {
  switch (trigger) {
    case 'off':
      return v.tts.triggerOff;
    case 'always':
      return v.tts.triggerAlways;
    case 'inbound':
      return v.tts.triggerInbound;
    case 'tagged':
      return v.tts.triggerTagged;
  }
}

function providerCapabilityHint(id: string, v: VoiceSettingsMessages): string {
  switch (id) {
    case 'edge':
      return v.tts.providerHints.edge;
    case 'openai':
      return v.tts.providerHints.openai;
    case 'alibaba':
      return v.tts.providerHints.alibaba;
    case 'minimax':
      return v.tts.providerHints.minimax;
    case 'tts-local-cli':
      return v.tts.providerHints.localCli;
    default:
      return v.tts.providerHints.generic;
  }
}

function voiceApiKeyLabels(v: VoiceSettingsMessages): VoiceApiKeyFieldLabels {
  return {
    maskedHelp: v.apiKeyMaskedHelp,
    copy: v.apiKeyCopy,
    copied: v.apiKeyCopied,
    show: v.apiKeyShow,
    hide: v.apiKeyHide,
    notInConfigFile: v.apiKeyNotInConfigFile,
    loadFailed: v.apiKeyRevealFailed,
  };
}

function readSchemaFieldValue(
  source: Record<string, unknown>,
  field: VoiceConfigFieldMetadata,
): string | number | boolean {
  const value = source[field.key];
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (field.defaultValue !== undefined) {
    return field.defaultValue;
  }
  return field.type === 'boolean' ? false : '';
}

function parseSchemaFieldValue(field: VoiceConfigFieldMetadata, rawValue: string | boolean): unknown {
  if (field.type === 'boolean') return Boolean(rawValue);
  if (field.type !== 'number') return rawValue;
  const trimmedValue = String(rawValue).trim();
  if (!trimmedValue) return undefined;
  const numberValue = Number(trimmedValue);
  return Number.isFinite(numberValue) ? numberValue : undefined;
}

type VoiceFormDraft = {
  form: VoiceSettingsState | null;
  baseline: VoiceSettingsState | null;
};

type VoiceFormAction =
  | { type: 'reset' }
  | { type: 'sync'; value: VoiceSettingsState }
  | { type: 'update'; updater: (prev: VoiceSettingsState | null) => VoiceSettingsState | null }
  | { type: 'saved'; value: VoiceSettingsState };

function voiceFormReducer(state: VoiceFormDraft, action: VoiceFormAction): VoiceFormDraft {
  switch (action.type) {
    case 'reset':
      return { form: null, baseline: null };
    case 'sync': {
      const snapshot = structuredClone(action.value);
      return { form: snapshot, baseline: structuredClone(snapshot) };
    }
    case 'update':
      return { ...state, form: action.updater(state.form) };
    case 'saved': {
      const snapshot = structuredClone(action.value);
      const hasNewerEdits = state.form !== null && JSON.stringify(state.form) !== JSON.stringify(action.value);
      return {
        form: hasNewerEdits ? state.form : snapshot,
        baseline: structuredClone(snapshot),
      };
    }
  }
}

export function VoiceSettingsPanel() {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const v = m.voiceSettings;
  const token = useGatewayStore((st) => st.token);
  const hasToken = Boolean(token);

  const [formDraft, dispatchForm] = useReducer(voiceFormReducer, { form: null, baseline: null });
  const form = formDraft.form;
  const baseline = formDraft.baseline;
  const [models, setModels] = useState<VoiceModelsPayload | null>(null);
  const dirtyRef = useRef(false);
  const formRef = useRef(form);
  formRef.current = form;
  const trackedVoiceSyncRef = useRef<{
    parsed: VoiceSettingsState | null;
    models: VoiceModelsPayload | null | undefined;
  }>({ parsed: null, models: undefined });

  const {
    data: cfgData,
    error: cfgErr,
    isLoading: cfgLoading,
    mutate: mutCfg,
  } = useGatewayConfigSwr(hasToken);
  const {
    data: voiceModels,
    error: vmErr,
    isLoading: vmLoading,
    mutate: mutVm,
  } = useSWR(hasToken ? apiUrl('/api/voice/models') : null, fetchVoiceModels, { revalidateOnFocus: false });
  const {
    data: voiceProviders,
    error: vpErr,
    isLoading: vpLoading,
  } = useSWR(hasToken ? apiUrl('/api/voice/providers') : null, fetchVoiceProviders, {
    revalidateOnFocus: false,
  });
  const {
    data: voiceSttProviders,
    error: vspErr,
    isLoading: vspLoading,
  } = useSWR(hasToken ? apiUrl('/api/voice/stt-providers') : null, fetchVoiceSttProviders, {
    revalidateOnFocus: false,
  });

  const ttsProviders = useMemo(
    () => voiceProviders?.providers ?? [],
    [voiceProviders],
  );

  const sttProviders = useMemo(
    () => voiceSttProviders?.providers ?? [],
    [voiceSttProviders],
  );

  const voiceParsed = useMemo(
    () =>
      cfgData?.payload?.config !== undefined
        ? normalizeVoiceSettings(cfgData.payload.config)
        : null,
    [cfgData],
  );

  const dirty = useMemo(() => {
    if (!form || !baseline) return false;
    return JSON.stringify(form) !== JSON.stringify(baseline);
  }, [form, baseline]);

  if (!hasToken) {
    if (trackedVoiceSyncRef.current.parsed !== null || trackedVoiceSyncRef.current.models !== undefined) {
      trackedVoiceSyncRef.current = { parsed: null, models: undefined };
      dispatchForm({ type: 'reset' });
      setModels(null);
      dirtyRef.current = false;
    }
  } else if (voiceParsed !== null && voiceModels !== undefined && !dirtyRef.current) {
    if (
      trackedVoiceSyncRef.current.parsed !== voiceParsed ||
      trackedVoiceSyncRef.current.models !== voiceModels
    ) {
      trackedVoiceSyncRef.current = { parsed: voiceParsed, models: voiceModels };
      dispatchForm({ type: 'sync', value: voiceParsed });
      setModels(voiceModels);
    }
  }

  const loading = Boolean(
    hasToken &&
      (voiceParsed === null ||
        voiceModels === undefined ||
        voiceProviders === undefined ||
        voiceSttProviders === undefined) &&
      (cfgLoading || vmLoading || vpLoading || vspLoading),
  );
  const fetchError =
    cfgErr instanceof Error
      ? cfgErr.message
      : cfgErr
        ? String(cfgErr)
        : vmErr instanceof Error
          ? vmErr.message
          : vmErr
            ? String(vmErr)
            : vpErr instanceof Error
              ? vpErr.message
              : vpErr
                ? String(vpErr)
                : vspErr instanceof Error
                  ? vspErr.message
                  : vspErr
                    ? String(vspErr)
                    : null;

  const updateStt = useCallback((patch: Partial<VoiceSettingsState['stt']>) => {
    dirtyRef.current = true;
    dispatchForm({
      type: 'update',
      updater: (f) => (f ? { ...f, stt: { ...f.stt, ...patch } } : null),
    });
  }, []);

  const updateSttFallback = useCallback((patch: Partial<NonNullable<VoiceSettingsState['stt']['fallback']>>) => {
    dirtyRef.current = true;
    dispatchForm({
      type: 'update',
      updater: (f) => {
        if (!f) return null;
        const cur = f.stt.fallback ?? { enabled: false, order: ['xopc-local'] };
        return {
          ...f,
          stt: {
            ...f.stt,
            fallback: { ...cur, ...patch },
          },
        };
      },
    });
  }, []);

  const updateVoiceRefinement = useCallback(
    (patch: Partial<VoiceSettingsState['voice']['input']['refinement']>) => {
      dirtyRef.current = true;
      dispatchForm({
        type: 'update',
        updater: (f) =>
          f
            ? {
                ...f,
                voice: {
                  ...f.voice,
                  input: {
                    ...f.voice.input,
                    refinement: { ...f.voice.input.refinement, ...patch },
                  },
                },
              }
            : null,
      });
    },
    [],
  );

  const updateVoiceLanguageMode = useCallback((languageMode: 'auto' | 'manual') => {
    dirtyRef.current = true;
    dispatchForm({
      type: 'update',
      updater: (f) =>
        f
          ? {
              ...f,
              voice: {
                ...f.voice,
                languageMode,
                ...(languageMode === 'auto' ? { language } : {}),
              },
            }
          : null,
    });
  }, [language]);

  const updateTts = useCallback((patch: Partial<VoiceSettingsState['tts']>) => {
    dirtyRef.current = true;
    dispatchForm({
      type: 'update',
      updater: (f) => (f ? { ...f, tts: { ...f.tts, ...patch } } : null),
    });
  }, []);

  const save = useCallback(async (snapshot: VoiceSettingsState) => {
    const switchedToLocal = baseline?.stt.provider !== 'xopc-local'
      && snapshot.stt.provider === 'xopc-local';
    try {
      await patchVoiceSettings(snapshot);
      if (switchedToLocal) {
        window.dispatchEvent(new Event(LOCAL_VOICE_MODEL_INSTALL_STARTED_EVENT));
      }
      dispatchForm({ type: 'saved', value: snapshot });
      dirtyRef.current = Boolean(
        formRef.current && JSON.stringify(formRef.current) !== JSON.stringify(snapshot),
      );
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : v.saveError);
    }
  }, [baseline?.stt.provider, v.saveError]);

  const autosave = useAutosave({ value: form, dirty, onSave: save });

  if (!hasToken) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-fg-muted">{v.needToken}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <SettingsPanelSkeleton rows={4} />
    );
  }

  if (!form || models === null) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-fg-muted">{fetchError ?? v.loadError}</p>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            void mutCfg();
            void mutVm();
          }}
        >
          {v.retry}
        </Button>
      </div>
    );
  }

  const stt = form.stt;
  const tts = form.tts;
  const refinement = form.voice.input.refinement;
  const apiKeyLabels = voiceApiKeyLabels(v);

  return (
    <div className="flex flex-col gap-4" onBlurCapture={autosave.onBlurCapture}>
      <div className="flex justify-end"><AutosaveStatus status={autosave.status} error={autosave.error} /></div>
      {autosave.error ? <p className="text-sm text-red-600 dark:text-red-400">{autosave.error}</p> : null}

      <div className="flex flex-col gap-4">
        <VoiceLanguageSection
          v={v}
          voice={form.voice}
          updateLanguageMode={updateVoiceLanguageMode}
        />
        <VoiceOverview v={v} stt={stt} tts={tts} />

        <SttSection
          v={v}
          apiKeyLabels={apiKeyLabels}
          stt={stt}
          models={models}
          sttProviders={sttProviders}
          refinement={refinement}
          updateStt={updateStt}
          updateSttFallback={updateSttFallback}
          updateRefinement={updateVoiceRefinement}
        />

        <TtsSection
          v={v}
          apiKeyLabels={apiKeyLabels}
          tts={tts}
          models={models}
          ttsProviders={ttsProviders}
          updateTts={updateTts}
        />
      </div>

      <div className="rounded-xl border border-accent/25 bg-accent/5 px-4 py-3 dark:border-accent/30 dark:bg-accent/10">
        <p className="text-sm text-fg">
          <strong className="text-accent">{v.notes.title}</strong> {v.notes.duration}
        </p>
        <p className="mt-2 text-xs text-fg-muted">{v.notes.envVars}</p>
      </div>
    </div>
  );
}

function VoiceLanguageSection({
  v,
  voice,
  updateLanguageMode,
}: {
  v: VoiceSettingsMessages;
  voice: VoiceSettingsState['voice'];
  updateLanguageMode: (mode: 'auto' | 'manual') => void;
}) {
  return (
    <section className="rounded-2xl bg-surface-base px-4 py-5 sm:px-5">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,18rem)] sm:items-center">
        <div>
          <div className="text-sm font-semibold text-fg">{v.language.title}</div>
          <p className="mt-1 text-xs text-fg-muted">
            {voice.languageMode === 'auto' ? v.language.autoDescription : v.language.manualDescription}
          </p>
        </div>
        <Select
          className={selectClassName()}
          value={voice.languageMode}
          onChange={(e) => updateLanguageMode(e.target.value as 'auto' | 'manual')}
        >
          <SelectOption value="auto">{v.language.auto}</SelectOption>
          <SelectOption value="manual">{v.language.manual}</SelectOption>
        </Select>
      </div>
    </section>
  );
}

function VoiceOverview({
  v,
  stt,
  tts,
}: {
  v: VoiceSettingsMessages;
  stt: VoiceSettingsState['stt'];
  tts: VoiceSettingsState['tts'];
}) {
  const configuredVoice = tts.providers?.[tts.provider]?.voice;
  const replyVoice = typeof configuredVoice === 'string' ? configuredVoice : undefined;
  return (
    <section className="rounded-2xl bg-surface-base px-4 py-5 sm:px-5">
      <div className="mb-4">
        <div className="text-sm font-semibold text-fg">{v.overview.title}</div>
        <p className="mt-1 text-xs text-fg-muted">{v.overview.description}</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <VoiceStatusPill label={v.overview.input} value={stt.enabled ? `${v.overview.ready} · ${sttProviderLabel(stt.provider, v)}` : v.overview.off} ready={stt.enabled} />
        <VoiceStatusPill label={v.overview.replies} value={tts.enabled ? ttsTriggerLabel(tts.trigger, v) : v.overview.off} ready={tts.enabled && tts.trigger !== 'off'} />
        <VoiceStatusPill label={v.overview.voice} value={tts.enabled ? `${ttsProviderLabel(tts.provider, v)}${replyVoice ? ` · ${replyVoice}` : ''}` : v.overview.off} ready={tts.enabled} />
      </div>
    </section>
  );
}

function VoiceStatusPill({ label, value, ready }: { label: string; value: string; ready: boolean }) {
  return (
    <div className="rounded-xl bg-surface-panel/80 px-3 py-2.5 shadow-surface">
      <div className="text-xs text-fg-muted">{label}</div>
      <div className={cn('mt-1 text-sm font-medium', ready ? 'text-fg' : 'text-fg-muted')}>{value}</div>
    </div>
  );
}

function SttSection({
  v,
  apiKeyLabels,
  stt,
  models,
  sttProviders,
  refinement,
  updateStt,
  updateSttFallback,
  updateRefinement,
}: {
  v: VoiceSettingsMessages;
  apiKeyLabels: VoiceApiKeyFieldLabels;
  stt: VoiceSettingsState['stt'];
  models: VoiceModelsPayload | null;
  sttProviders: SttProviderListEntry[];
  refinement: VoiceSettingsState['voice']['input']['refinement'];
  updateStt: (p: Partial<VoiceSettingsState['stt']>) => void;
  updateSttFallback: (p: Partial<NonNullable<VoiceSettingsState['stt']['fallback']>>) => void;
  updateRefinement: (p: Partial<VoiceSettingsState['voice']['input']['refinement']>) => void;
}) {
  const providerOptions = useMemo(() => {
    const seen = new Set<string>();
    const options: SttProviderListEntry[] = [];
    for (const entry of sttProviders) {
      if (seen.has(entry.id)) continue;
      seen.add(entry.id);
      options.push(entry);
    }
    return options;
  }, [sttProviders]);

  const activeProvider = providerOptions.find((entry) => entry.id === stt.provider);
  const providerSlice = stt.providers?.[stt.provider] ?? {};
  const providerModels = models?.stt?.[stt.provider]?.length
    ? models.stt[stt.provider]
    : activeProvider?.models ?? [];
  const modelField = activeProvider?.fields.find((field) => field.key === 'model');
  const configuredModel = typeof providerSlice.model === 'string' ? providerSlice.model : undefined;
  const currentModel = configuredModel
    ?? (typeof modelField?.defaultValue === 'string' ? modelField.defaultValue : providerModels[0]?.id);

  const updateProviderSlice = useCallback(
    (patch: Record<string, unknown>) => {
      updateStt({
        providers: {
          ...(stt.providers ?? {}),
          [stt.provider]: {
            ...(stt.providers?.[stt.provider] ?? {}),
            ...patch,
          },
        },
      });
    },
    [stt.provider, stt.providers, updateStt],
  );

  useEffect(() => {
    if (modelField && currentModel && configuredModel !== currentModel) {
      updateProviderSlice({ model: currentModel });
    }
  }, [configuredModel, currentModel, modelField, updateProviderSlice]);

  return (
    <section className="rounded-2xl bg-surface-base px-4 py-5 sm:px-5">
      <div className="mb-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-fg">
          <Mic className="size-4 text-accent" strokeWidth={1.75} />
          {v.stt.title}
        </div>
        <p className="mt-1 text-xs text-fg-muted">{v.stt.description}</p>
      </div>
      <div className="space-y-4">
        <ProminentVoiceToggle
          checked={stt.enabled}
          title={v.stt.enable}
          description={v.stt.enableDesc}
          onLabel={v.overview.ready}
          offLabel={v.overview.off}
          onChange={(enabled) => updateStt({ enabled })}
        />

        {stt.enabled ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className={cn('flex flex-col gap-1.5', credentialFieldWidthClass)}>
                <FieldLabel>{v.stt.provider}</FieldLabel>
                <Select
                  className={selectClassName()}
                  value={stt.provider}
                  onChange={(event) => updateStt({ provider: event.target.value })}
                >
                  {providerOptions.map((entry) => (
                    <SelectOption key={entry.id} value={entry.id}>
                      {sttProviderLabel(entry.id, v)}
                      {entry.configured ? '' : ' *'}
                    </SelectOption>
                  ))}
                </Select>
              </div>

              <VoiceProviderConfigFields
                kind="stt"
                providerId={stt.provider}
                fields={activeProvider?.fields ?? []}
                providerSlice={providerSlice}
                models={providerModels}
                currentModel={currentModel}
                apiKeyLabels={apiKeyLabels}
                onPatch={updateProviderSlice}
              />
            </div>

            {stt.provider === 'xopc-local' ? <LocalVoiceModelsPanel v={v} /> : null}

            <div className="flex items-center justify-between gap-2 rounded-xl bg-surface-hover/50 px-3 py-2.5 dark:bg-surface-hover/35">
              <div>
                <div className="text-sm font-medium text-fg">{v.stt.fallback}</div>
                <p className="text-xs text-fg-muted">{v.stt.fallbackDesc}</p>
              </div>
              <input
                type="checkbox"
                className="ui-checkbox"
                checked={stt.fallback?.enabled ?? false}
                onChange={(e) => updateSttFallback({ enabled: e.target.checked })}
              />
            </div>

            <div className="grid gap-3 rounded-xl bg-surface-hover/50 p-3 dark:bg-surface-hover/35 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,18rem)] sm:items-center">
              <div>
                <div className="text-sm font-medium text-fg">{v.stt.refinement}</div>
                <p className="text-xs text-fg-muted">{v.stt.refinementDesc}</p>
              </div>
              <Select
                className={selectClassName()}
                value={refinement.mode}
                onChange={(e) =>
                  updateRefinement({
                    mode: e.target.value as VoiceSettingsState['voice']['input']['refinement']['mode'],
                  })
                }
              >
                <SelectOption value="off">{v.stt.refinementOff}</SelectOption>
                <SelectOption value="punctuation">{v.stt.refinementPunctuation}</SelectOption>
                <SelectOption value="light">{v.stt.refinementLight}</SelectOption>
              </Select>
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}

function localModelSize(bytes: number): string {
  return `${Math.round(bytes / 1024 / 1024)} MB`;
}

function LocalVoiceModelsPanel({ v }: { v: VoiceSettingsMessages }) {
  const { data, error, mutate } = useSWR(
    apiUrl('/api/voice/local/status'),
    fetchLocalVoiceStatus,
    {
      revalidateOnFocus: false,
      refreshInterval: (latest) =>
        latest?.models.some((model) => model.state === 'downloading') ? 1000 : 0,
    },
  );
  const [busyModel, setBusyModel] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    const refresh = () => void mutate();
    window.addEventListener(LOCAL_VOICE_MODEL_INSTALL_STARTED_EVENT, refresh);
    return () => window.removeEventListener(LOCAL_VOICE_MODEL_INSTALL_STARTED_EVENT, refresh);
  }, [mutate]);

  const runAction = useCallback(
    async (model: LocalVoiceModelStatus, action: 'install' | 'remove') => {
      setBusyModel(model.id);
      setActionError(null);
      try {
        if (action === 'install') await installLocalVoiceModel(model.id);
        else await removeLocalVoiceModel(model.id);
        await mutate();
      } catch (cause) {
        setActionError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusyModel(null);
      }
    },
    [mutate],
  );

  return (
    <div className="rounded-xl border border-edge bg-surface-panel/60 p-3">
      <div className="text-sm font-medium text-fg">{v.stt.localModels}</div>
      <p className="mt-1 text-xs text-fg-muted">{v.stt.localModelsDesc}</p>
      {error ? <p className="mt-3 text-xs text-red-600 dark:text-red-400">{String(error)}</p> : null}
      {data?.runtime.ready === false ? (
        <p className="mt-3 text-xs text-red-600 dark:text-red-400">
          {data.runtime.error ?? 'Local voice runtime is unavailable'}
        </p>
      ) : null}
      {data?.decoder?.available === false ? (
        <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">
          {data.decoder.error ?? 'Compressed audio decoding is unavailable'}
        </p>
      ) : null}
      {actionError ? <p className="mt-3 text-xs text-red-600 dark:text-red-400">{actionError}</p> : null}
      <div className="mt-3 grid gap-2">
        {(data?.models ?? []).map((model) => {
          const busy = busyModel === model.id || model.state === 'downloading';
          return (
            <div
              key={model.id}
              className={cn(
                'flex items-center justify-between gap-3 rounded-lg bg-surface-base px-3 py-2.5',
                model.recommended ? 'ring-1 ring-accent/40' : '',
              )}
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-fg">
                  {model.name}
                  {model.recommended ? (
                    <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent">
                      {v.stt.localRecommended}
                    </span>
                  ) : null}
                </div>
                <div className="text-xs text-fg-muted">
                  {localModelSize(model.approximateBytes)} · {model.description}
                </div>
                <div className="mt-0.5 text-[11px] text-fg-subtle">
                  {model.engine} · {model.languages.join(' / ')}
                </div>
                {model.state === 'downloading' ? (
                  <div className="mt-1 text-xs text-accent">
                    {v.stt.localDownloading} {Math.round((model.progress ?? 0) * 100)}%
                  </div>
                ) : model.state === 'error' ? (
                  <div className="mt-1 text-xs text-red-600 dark:text-red-400">{model.error}</div>
                ) : null}
              </div>
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => void runAction(model, model.state === 'ready' ? 'remove' : 'install')}
              >
                {busy ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : model.state === 'ready' ? (
                  v.stt.localRemove
                ) : (
                  v.stt.localInstall
                )}
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TtsSection({
  v,
  apiKeyLabels,
  tts,
  models,
  ttsProviders,
  updateTts,
}: {
  v: VoiceSettingsMessages;
  apiKeyLabels: VoiceApiKeyFieldLabels;
  tts: VoiceSettingsState['tts'];
  models: VoiceModelsPayload | null;
  ttsProviders: TtsProviderListEntry[];
  updateTts: (p: Partial<VoiceSettingsState['tts']>) => void;
}) {
  const [testText, setTestText] = useState(v.tts.test.sampleText);
  const [testState, setTestState] = useState<
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'playing'; summary: string }
    | { status: 'done'; summary: string }
    | { status: 'error'; message: string }
  >({ status: 'idle' });
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);

  const stopTestAudio = useCallback(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
  }, []);

  const providerOptions = useMemo(() => {
    const seen = new Set<string>();
    const options: TtsProviderListEntry[] = [];
    for (const entry of ttsProviders) {
      if (seen.has(entry.id)) continue;
      seen.add(entry.id);
      options.push(entry);
    }
    return options;
  }, [ttsProviders]);

  const activeProvider = providerOptions.find((entry) => entry.id === tts.provider);
  const providerSlice = tts.providers?.[tts.provider] ?? {};
  const providerModels = models?.tts?.[tts.provider]?.length
    ? models.tts[tts.provider]
    : activeProvider?.models ?? [];
  const modelField = activeProvider?.fields.find((field) => field.key === 'model');
  const voiceField = activeProvider?.fields.find((field) => field.key === 'voice');
  const configuredModel = typeof providerSlice.model === 'string' ? providerSlice.model : undefined;
  const currentModel = configuredModel
    ?? (typeof modelField?.defaultValue === 'string' ? modelField.defaultValue : providerModels[0]?.id);
  const activeModel = providerModels.find((model) => model.id === currentModel);
  const staticVoices = models?.ttsVoices?.[tts.provider]?.length
    ? models.ttsVoices[tts.provider]
    : activeProvider?.voices ?? [];

  const { data: discoveredVoices = [] } = useSWR(
    currentModel ? `voice:tts:${tts.provider}:${currentModel}` : null,
    () => fetchTtsVoices(tts.provider, currentModel ?? ''),
    { revalidateOnFocus: false },
  );
  const providerVoices = discoveredVoices.length > 0 ? discoveredVoices : staticVoices;
  const configuredVoice = typeof providerSlice.voice === 'string' ? providerSlice.voice : undefined;
  const currentVoice = configuredVoice
    ?? providerVoices.find((voice) => voice.id === activeModel?.tts?.defaultVoice)?.id
    ?? (typeof voiceField?.defaultValue === 'string' ? voiceField.defaultValue : providerVoices[0]?.id);
  const visibleFields = (activeProvider?.fields ?? []).filter(
    (field) => (field.key !== 'speed' || activeModel?.tts?.speed !== false)
      && (field.key !== 'instructions' || activeModel?.tts?.instructions !== false),
  );
  const providerNeedsKey = Boolean(activeProvider?.diagnostics.requiresApiKey);
  const providerReady = Boolean(activeProvider?.configured) || !providerNeedsKey;
  const statusTone = !tts.enabled
    ? 'muted'
    : providerReady
      ? 'ready'
      : 'action';

  const updateProviderSlice = useCallback(
    (patch: Record<string, unknown>) => {
      updateTts({
        providers: {
          ...(tts.providers ?? {}),
          [tts.provider]: { ...(tts.providers?.[tts.provider] ?? {}), ...patch },
        },
      });
    },
    [tts.provider, tts.providers, updateTts],
  );

  useEffect(() => {
    const next: Record<string, unknown> = {};
    if (modelField && currentModel && configuredModel !== currentModel) next.model = currentModel;
    if (voiceField && currentVoice && configuredVoice !== currentVoice) next.voice = currentVoice;
    if (Object.keys(next).length > 0) updateProviderSlice(next);
  }, [configuredModel, configuredVoice, currentModel, currentVoice, modelField, updateProviderSlice, voiceField]);

  useEffect(() => () => stopTestAudio(), [stopTestAudio]);

  const handleProviderSelect = useCallback(
    (providerId: string) => {
      updateTts({ provider: providerId });
      setTestState({ status: 'idle' });
    },
    [updateTts],
  );

  const handleTestVoice = useCallback(async () => {
    const text = testText.trim();
    if (!text) {
      setTestState({ status: 'error', message: v.tts.test.emptyText });
      return;
    }
    stopTestAudio();
    setTestState({ status: 'loading' });
    try {
      const result = await testTtsVoice({
        text,
        provider: tts.provider,
        providerConfig: providerSlice,
        ...(currentModel ? { model: currentModel } : {}),
        ...(currentVoice ? { voice: currentVoice } : {}),
      });
      const url = makeAudioUrl(result.audio, result.mimeType);
      audioUrlRef.current = url;
      const audio = new Audio(url);
      audioRef.current = audio;
      const summary = [
        result.provider,
        result.format,
        result.latencyMs !== undefined ? `${result.latencyMs}ms` : undefined,
        audioBytesLabel(result.audioSize),
      ].filter(Boolean).join(' · ');
      audio.addEventListener('ended', () => setTestState({ status: 'done', summary }), { once: true });
      audio.addEventListener('error', () => setTestState({ status: 'error', message: v.tts.test.playFailed }), { once: true });
      await audio.play();
      setTestState({ status: 'playing', summary });
    } catch (err) {
      stopTestAudio();
      setTestState({ status: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }, [currentModel, currentVoice, providerSlice, stopTestAudio, testText, tts.provider, v.tts.test.emptyText, v.tts.test.playFailed]);

  return (
    <section className="rounded-2xl bg-surface-base px-4 py-5 sm:px-5">
      <div className="mb-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-fg">
          <Volume2 className="size-4 text-accent" strokeWidth={1.75} />
          {v.tts.title}
        </div>
        <p className="mt-1 text-xs text-fg-muted">{v.tts.description}</p>
      </div>
      <div className="space-y-4">
        <ProminentVoiceToggle
          checked={tts.enabled}
          title={v.tts.enable}
          description={v.tts.enableDesc}
          onLabel={v.overview.ready}
          offLabel={v.overview.off}
          onChange={(enabled) => updateTts({ enabled })}
        />

        <div
          className={cn(
            'rounded-xl border px-3 py-2.5 text-sm',
            statusTone === 'ready'
              ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-800 dark:text-emerald-100'
              : statusTone === 'action'
                ? 'border-amber-300/50 bg-amber-50 text-amber-900 dark:border-amber-300/30 dark:bg-amber-400/10 dark:text-amber-100'
                : 'border-edge bg-surface-panel text-fg-muted',
          )}
        >
          <div className="font-medium text-fg">{v.tts.statusTitle}</div>
          <p className="mt-1 text-xs">
            {!tts.enabled
              ? v.tts.statusOff
              : providerReady
                ? `${v.tts.statusReady} ${ttsProviderLabel(tts.provider, v)}${currentVoice ? ` · ${currentVoice}` : ''}`
                : `${v.tts.statusNeedsSetup} ${ttsProviderLabel(tts.provider, v)} · ${activeProvider?.diagnostics.envKeys?.join(', ') ?? v.stt.apiKey}`}
          </p>
        </div>

        {tts.enabled ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className={cn('flex flex-col gap-1.5', credentialFieldWidthClass)}>
                <FieldLabel>{v.tts.trigger}</FieldLabel>
                <Select
                  className={selectClassName()}
                  value={tts.trigger}
                  onChange={(e) => updateTts({ trigger: e.target.value as VoiceSettingsState['tts']['trigger'] })}
                >
                  <SelectOption value="off">{v.tts.triggerOff}</SelectOption>
                  <SelectOption value="inbound">{v.tts.triggerInbound}</SelectOption>
                  <SelectOption value="tagged">{v.tts.triggerTagged}</SelectOption>
                  <SelectOption value="always">{v.tts.triggerAlways}</SelectOption>
                </Select>
                <p className="text-xs text-fg-subtle">{v.tts.triggerHelp}</p>
              </div>

              <div className={cn('flex flex-col gap-1.5', credentialFieldWidthClass)}>
                <FieldLabel>{v.tts.provider}</FieldLabel>
                <Select
                  className={selectClassName()}
                  value={tts.provider}
                  onChange={(e) => handleProviderSelect(e.target.value)}
                >
                  {providerOptions.map((entry) => (
                    <SelectOption key={entry.id} value={entry.id}>
                      {ttsProviderLabel(entry.id, v)}
                    </SelectOption>
                  ))}
                </Select>
                <p className="text-xs text-fg-subtle">
                  {activeProvider?.configured
                    ? v.tts.configured
                    : activeProvider?.diagnostics.requiresApiKey
                      ? `${v.tts.needsKey} · ${activeProvider.diagnostics.envKeys?.join(', ') ?? v.stt.apiKey}`
                      : v.tts.noKeyNeeded}
                  {' · '}
                  {activeProvider?.description ?? providerCapabilityHint(tts.provider, v)}
                </p>
              </div>
            </div>

            <details
              className="rounded-xl bg-surface-panel/80 p-3 shadow-surface"
              open={!providerReady || tts.provider === 'tts-local-cli'}
            >
              <summary className="cursor-pointer text-sm font-medium text-fg marker:text-fg-muted">
                {v.tts.advanced.title}
                <span className="ml-2 text-xs font-normal text-fg-muted">{v.tts.advanced.description}</span>
              </summary>
              <div className="mt-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <VoiceProviderConfigFields
                    kind="tts"
                    providerId={tts.provider}
                    fields={visibleFields}
                    providerSlice={providerSlice}
                    models={providerModels}
                    voices={providerVoices}
                    currentModel={currentModel}
                    currentVoice={currentVoice}
                    apiKeyLabels={apiKeyLabels}
                    onPatch={updateProviderSlice}
                    resetVoiceOnModelChange
                  />
                </div>
              </div>
            </details>

            <div className="rounded-xl bg-surface-panel/80 p-3 shadow-surface">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="text-sm font-medium text-fg">{v.tts.test.title}</div>
                  <p className="mt-1 text-xs text-fg-muted">{v.tts.test.description}</p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    type="button"
                    variant="primary"
                    onClick={() => void handleTestVoice()}
                    disabled={testState.status === 'loading'}
                    className="h-9"
                  >
                    {testState.status === 'loading' ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
                    {testState.status === 'loading' ? v.tts.test.generating : v.tts.test.play}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      stopTestAudio();
                      setTestState((prev) => prev.status === 'playing' ? { status: 'done', summary: prev.summary } : { status: 'idle' });
                    }}
                    disabled={testState.status !== 'playing'}
                    className="h-9"
                  >
                    <Square className="size-4" />
                    {v.tts.test.stop}
                  </Button>
                </div>
              </div>
              <textarea
                className={cn(inputClassName(), 'mt-3 min-h-20 resize-y')}
                value={testText}
                onChange={(e) => setTestText(e.target.value)}
                maxLength={1000}
              />
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="text-fg-subtle">{testText.length}/1000</span>
                {testState.status === 'playing' || testState.status === 'done' ? (
                  <span className="text-emerald-700 dark:text-emerald-200">
                    {testState.status === 'playing' ? v.tts.test.playing : v.tts.test.ready} · {testState.summary}
                  </span>
                ) : null}
                {testState.status === 'error' ? (
                  <span className="text-red-600 dark:text-red-400">{testState.message}</span>
                ) : null}
              </div>
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}

function VoiceProviderConfigFields({
  kind,
  providerId,
  fields,
  providerSlice,
  models,
  voices = [],
  currentModel,
  currentVoice,
  apiKeyLabels,
  onPatch,
  resetVoiceOnModelChange = false,
}: {
  kind: 'stt' | 'tts';
  providerId: string;
  fields: VoiceConfigFieldMetadata[];
  providerSlice: Record<string, unknown>;
  models: VoiceModelsPayload['stt'][string];
  voices?: VoiceModelsPayload['ttsVoices'][string];
  currentModel?: string;
  currentVoice?: string;
  apiKeyLabels: VoiceApiKeyFieldLabels;
  onPatch: (patch: Record<string, unknown>) => void;
  resetVoiceOnModelChange?: boolean;
}) {
  return fields.map((field) => {
    if (field.key === 'apiKey') {
      return (
        <div key={field.key} className={cn('flex flex-col gap-1.5', credentialFieldWidthClass)}>
          <FieldLabel>{field.label}</FieldLabel>
          <VoiceApiKeyField
            kind={kind}
            providerId={providerId}
            fieldId={`voice-${kind}-${providerId}-api-key`}
            value={typeof providerSlice.apiKey === 'string' ? providerSlice.apiKey : ''}
            onChange={(apiKey) => onPatch({ apiKey })}
            labels={apiKeyLabels}
            placeholder={field.placeholder}
          />
          {field.description ? <p className="text-xs text-fg-subtle">{field.description}</p> : null}
        </div>
      );
    }
    if (field.key === 'model' && models.length > 0) {
      return (
        <div key={field.key} className={cn('flex flex-col gap-1.5', credentialFieldWidthClass)}>
          <FieldLabel>{field.label}</FieldLabel>
          <Select
            className={selectClassName()}
            value={currentModel ?? ''}
            onChange={(event) => onPatch({
              model: event.target.value,
              ...(resetVoiceOnModelChange ? { voice: undefined } : {}),
            })}
          >
            {models.map((model) => (
              <SelectOption key={model.id} value={model.id}>{model.name}</SelectOption>
            ))}
          </Select>
        </div>
      );
    }
    if (field.key === 'voice' && voices.length > 0) {
      return (
        <div key={field.key} className={cn('flex flex-col gap-1.5', credentialFieldWidthClass)}>
          <FieldLabel>{field.label}</FieldLabel>
          <Select
            className={selectClassName()}
            value={currentVoice ?? ''}
            onChange={(event) => onPatch({ voice: event.target.value })}
          >
            {voices.map((voice) => (
              <SelectOption key={voice.id} value={voice.id}>{voice.name}</SelectOption>
            ))}
          </Select>
        </div>
      );
    }
    return (
      <SchemaConfigField
        key={field.key}
        field={field}
        value={readSchemaFieldValue(providerSlice, field)}
        onChange={(next) => onPatch({ [field.key]: next })}
        className={field.type === 'textarea' ? 'sm:col-span-2' : credentialFieldWidthClass}
      />
    );
  });
}

function ProminentVoiceToggle({
  checked,
  title,
  description,
  onLabel,
  offLabel,
  onChange,
}: {
  checked: boolean;
  title: string;
  description: string;
  onLabel: string;
  offLabel: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        'group flex w-full items-center justify-between gap-4 rounded-2xl px-4 py-3 text-left shadow-surface transition-colors',
        settingsInputFocusClass,
        checked
          ? 'bg-accent/10 text-fg ring-1 ring-accent/45 dark:bg-accent/15'
          : 'bg-surface-panel/80 text-fg hover:bg-surface-hover',
      )}
    >
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-fg">
          {title}
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-[11px] font-medium',
              checked ? 'bg-accent text-white' : 'bg-surface-hover text-fg-muted',
            )}
          >
            {checked ? onLabel : offLabel}
          </span>
        </span>
        <span className="mt-1 block text-xs leading-relaxed text-fg-muted">{description}</span>
      </span>
      <span
        className={cn(
          'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors',
          checked ? 'border-accent bg-accent' : 'border-edge bg-surface-hover group-hover:border-accent/40',
        )}
        aria-hidden
      >
        <span
          className={cn(
            'size-5 rounded-full bg-white shadow-surface transition-transform',
            checked ? 'translate-x-5' : 'translate-x-0.5',
          )}
        />
      </span>
    </button>
  );
}

function SchemaConfigField({
  field,
  value,
  onChange,
  className,
}: {
  field: VoiceConfigFieldMetadata;
  value: string | number | boolean;
  onChange: (next: unknown) => void;
  className?: string;
}) {
  const id = `voice-schema-field-${field.key}`;
  const description = field.description;

  if (field.type === 'boolean') {
    return (
      <label className={cn('flex items-center justify-between gap-3 rounded-xl bg-surface-hover/50 px-3 py-2.5 dark:bg-surface-hover/35', className)}>
        <span>
          <span className="block text-sm font-medium text-fg">{field.label}</span>
          {description ? <span className="mt-1 block text-xs text-fg-subtle">{description}</span> : null}
        </span>
        <input
          type="checkbox"
          className="ui-checkbox"
          checked={Boolean(value)}
          onChange={(event) => onChange(parseSchemaFieldValue(field, event.target.checked))}
        />
      </label>
    );
  }

  const fieldValue = typeof value === 'boolean' ? '' : String(value);

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <FieldLabel>{field.label}</FieldLabel>
      {field.type === 'select' ? (
        <Select
          id={id}
          className={selectClassName()}
          value={fieldValue}
          required={field.required}
          onChange={(event) => onChange(parseSchemaFieldValue(field, event.target.value))}
        >
          {(field.options ?? []).map((option) => (
            <SelectOption key={option.id} value={option.id}>
              {option.name}
            </SelectOption>
          ))}
        </Select>
      ) : field.type === 'textarea' ? (
        <textarea
          id={id}
          className={cn(inputClassName(), 'min-h-24 resize-y')}
          value={fieldValue}
          required={field.required}
          placeholder={field.placeholder}
          onChange={(event) => onChange(parseSchemaFieldValue(field, event.target.value))}
        />
      ) : field.type === 'password' ? (
        <SecretInput
          id={id}
          className={className}
          value={fieldValue}
          onChange={(next) => onChange(parseSchemaFieldValue(field, next))}
          placeholder={field.placeholder}
          labels={DEFAULT_SECRET_INPUT_LABELS}
        />
      ) : (
        <input
          id={id}
          className={inputClassName()}
          type={field.type === 'number' ? 'number' : 'text'}
          autoComplete={field.secret ? 'new-password' : 'off'}
          spellCheck={false}
          value={fieldValue}
          required={field.required}
          placeholder={field.placeholder}
          min={field.min}
          max={field.max}
          step={field.step}
          onChange={(event) => onChange(parseSchemaFieldValue(field, event.target.value))}
        />
      )}
      {description ? <p className="text-xs text-fg-subtle">{description}</p> : null}
    </div>
  );
}

function FieldLabel({ children }: { children: ReactNode }) {
  return <div className="text-sm font-medium text-fg">{children}</div>;
}
