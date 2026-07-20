import { Loader2, Mic, Play, Square, Volume2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { SecretInput } from '@/components/ui/secret-input';
import { useSaveBarRegistration } from '@/features/settings/save-bar/use-save-bar-registration';
import { useGatewayConfigSwr } from '@/features/gateway/gateway-config-swr';
import { SettingsPanelSkeleton } from '@/features/settings/settings-loading-skeleton';
import {
  fetchVoiceModels,
  fetchVoiceProviders,
  fetchVoiceSttProviders,
  fetchLocalVoiceStatus,
  installLocalVoiceModel,
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
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';
import { Select, SelectOption } from '@/components/ui/popover-select';

const credentialFieldWidthClass = selectFieldMaxWidthClass;

function sttEnvHint(provider: string): string {
  switch (provider) {
    case 'alibaba':
      return '(DASHSCOPE_API_KEY)';
    case 'openai':
      return '(OPENAI_API_KEY)';
    case 'groq':
      return '(GROQ_API_KEY)';
    default:
      return '';
  }
}

function ttsEnvHint(provider: string): string {
  switch (provider) {
    case 'alibaba':
      return '(DASHSCOPE_API_KEY)';
    case 'openai':
      return '(OPENAI_API_KEY)';
    case 'minimax':
      return '(MINIMAX_API_KEY)';
    default:
      return '';
  }
}

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

const STT_ALIBABA_FALLBACK = [
  { id: 'paraformer-v2', name: 'Paraformer v2' },
  { id: 'paraformer-v1', name: 'Paraformer v1' },
];
const STT_OPENAI_FALLBACK = [{ id: 'whisper-1', name: 'Whisper-1' }];
const STT_GROQ_MODELS_FALLBACK = [
  { id: 'whisper-large-v3-turbo', name: 'Whisper Large v3 Turbo' },
  { id: 'whisper-large-v3', name: 'Whisper Large v3' },
];
const TTS_OPENAI_MODELS_FALLBACK = [
  { id: 'tts-1', name: 'TTS-1' },
  { id: 'tts-1-hd', name: 'TTS-1 HD' },
];
const TTS_OPENAI_VOICES_FALLBACK = [
  { id: 'alloy', name: 'Alloy' },
  { id: 'echo', name: 'Echo' },
];
const TTS_ALIBABA_MODELS_FALLBACK = [
  { id: 'qwen-tts', name: 'Qwen TTS' },
  { id: 'qwen3-tts-flash', name: 'Qwen3 TTS Flash' },
];
const TTS_ALIBABA_VOICES_FALLBACK = [
  { id: 'Cherry', name: 'Cherry' },
  { id: 'longxiaochun', name: 'Long Xiao Chun' },
];
const TTS_EDGE_VOICES_FALLBACK = [
  { id: 'en-US-MichelleNeural', name: 'Michelle (US English)' },
  { id: 'zh-CN-XiaoxiaoNeural', name: 'Xiaoxiao (Chinese)' },
];
const TTS_MINIMAX_MODELS_FALLBACK = [
  { id: 'speech-2.8-hd', name: 'Speech 2.8 HD (Recommended)' },
  { id: 'speech-2.8-turbo', name: 'Speech 2.8 Turbo (Fast)' },
];
const TTS_MINIMAX_VOICES_FALLBACK = [
  { id: 'male-qn-qingse', name: 'Male Qingse (青涩男声)' },
  { id: 'female-shaonv', name: 'Female Shaonv (少女音)' },
];

const TTS_LOCAL_CLI_PRESETS = [
  {
    id: 'piper',
    command: 'piper --model /path/to/voice.onnx --output_file "{{OutputPath}}"',
    outputFormat: 'wav' as const,
  },
  {
    id: 'sherpa-onnx',
    command: 'sherpa-onnx-offline-tts --text "{{Text}}" --output-filename "{{OutputPath}}"',
    outputFormat: 'wav' as const,
  },
  {
    id: 'mlx-audio',
    command: 'python -m mlx_audio.tts.generate --text "{{Text}}" --file_prefix "{{OutputBase}}"',
    outputFormat: 'wav' as const,
  },
];

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
  | { type: 'discard' }
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
    case 'discard':
      return state.baseline
        ? { form: structuredClone(state.baseline), baseline: state.baseline }
        : state;
    case 'saved': {
      const snapshot = structuredClone(action.value);
      return { form: snapshot, baseline: structuredClone(snapshot) };
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirtyRef = useRef(false);
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

  const updateSttAlibaba = useCallback((patch: Partial<NonNullable<VoiceSettingsState['stt']['alibaba']>>) => {
    dirtyRef.current = true;
    dispatchForm({
      type: 'update',
      updater: (f) =>
        f
          ? {
              ...f,
              stt: { ...f.stt, alibaba: { ...f.stt.alibaba, ...patch } },
            }
          : null,
    });
  }, []);

  const updateSttOpenai = useCallback((patch: Partial<NonNullable<VoiceSettingsState['stt']['openai']>>) => {
    dirtyRef.current = true;
    dispatchForm({
      type: 'update',
      updater: (f) =>
        f
          ? {
              ...f,
              stt: { ...f.stt, openai: { ...f.stt.openai, ...patch } },
            }
          : null,
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

  const updateTtsAlibaba = useCallback((patch: Partial<NonNullable<VoiceSettingsState['tts']['alibaba']>>) => {
    dirtyRef.current = true;
    dispatchForm({
      type: 'update',
      updater: (f) =>
        f
          ? {
              ...f,
              tts: { ...f.tts, alibaba: { ...f.tts.alibaba, ...patch } },
            }
          : null,
    });
  }, []);

  const updateTtsOpenai = useCallback((patch: Partial<NonNullable<VoiceSettingsState['tts']['openai']>>) => {
    dirtyRef.current = true;
    dispatchForm({
      type: 'update',
      updater: (f) =>
        f
          ? {
              ...f,
              tts: { ...f.tts, openai: { ...f.tts.openai, ...patch } },
            }
          : null,
    });
  }, []);

  const updateTtsEdge = useCallback((patch: Partial<NonNullable<VoiceSettingsState['tts']['edge']>>) => {
    dirtyRef.current = true;
    dispatchForm({
      type: 'update',
      updater: (f) =>
        f
          ? {
              ...f,
              voice:
                patch.voice !== undefined || patch.lang !== undefined
                  ? { ...f.voice, languageMode: 'manual' }
                  : f.voice,
              tts: { ...f.tts, edge: { ...f.tts.edge, ...patch } },
            }
          : null,
    });
  }, []);

  const updateTtsMinimax = useCallback(
    (patch: Partial<NonNullable<VoiceSettingsState['tts']['minimax']>>) => {
      dirtyRef.current = true;
      dispatchForm({
        type: 'update',
        updater: (f) => (f ? { ...f, tts: { ...f.tts, minimax: { ...f.tts.minimax, ...patch } } } : null),
      });
    },
    [],
  );

  const updateTtsLocalCli = useCallback(
    (patch: Partial<NonNullable<VoiceSettingsState['tts']['tts-local-cli']>>) => {
      dirtyRef.current = true;
      dispatchForm({
        type: 'update',
        updater: (f) =>
          f
            ? {
                ...f,
                tts: {
                  ...f.tts,
                  'tts-local-cli': { ...f.tts['tts-local-cli'], ...patch },
                },
              }
            : null,
      });
    },
    [],
  );

  const save = useCallback(async () => {
    if (!form || saving) return;
    setSaving(true);
    setError(null);
    try {
      await patchVoiceSettings(form);
      dispatchForm({ type: 'saved', value: form });
      dirtyRef.current = false;
    } catch (e) {
      setError(e instanceof Error ? e.message : v.saveError);
    } finally {
      setSaving(false);
    }
  }, [form, saving, v.saveError]);

  const discard = useCallback(() => {
    if (!baseline) return;
    dirtyRef.current = false;
    dispatchForm({ type: 'discard' });
    setError(null);
  }, [baseline]);

  useSaveBarRegistration({ id: 'voice', dirty, saving, save, discard });

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
        <p className="text-sm text-fg-muted">{error ?? fetchError ?? v.loadError}</p>
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
    <div className="flex flex-col gap-4">
      {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}

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
          updateSttAlibaba={updateSttAlibaba}
          updateSttOpenai={updateSttOpenai}
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
          updateTtsAlibaba={updateTtsAlibaba}
          updateTtsOpenai={updateTtsOpenai}
          updateTtsEdge={updateTtsEdge}
          updateTtsMinimax={updateTtsMinimax}
          updateTtsLocalCli={updateTtsLocalCli}
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
  const replyVoice =
    tts.provider === 'openai'
      ? tts.openai?.voice
      : tts.provider === 'alibaba'
        ? tts.alibaba?.voice
        : tts.provider === 'minimax'
          ? tts.minimax?.voice
          : tts.provider === 'edge'
            ? tts.edge?.voice
            : undefined;
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
  updateSttAlibaba,
  updateSttOpenai,
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
  updateSttAlibaba: (p: Partial<NonNullable<VoiceSettingsState['stt']['alibaba']>>) => void;
  updateSttOpenai: (p: Partial<NonNullable<VoiceSettingsState['stt']['openai']>>) => void;
  updateSttFallback: (p: Partial<NonNullable<VoiceSettingsState['stt']['fallback']>>) => void;
  updateRefinement: (p: Partial<VoiceSettingsState['voice']['input']['refinement']>) => void;
}) {
  const alibabaModels = models?.stt?.alibaba?.length ? models.stt.alibaba : STT_ALIBABA_FALLBACK;
  const openaiModels = models?.stt?.openai?.length ? models.stt.openai : STT_OPENAI_FALLBACK;

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
  const extensionProviderSlice = stt.providers?.[stt.provider];
  const extensionApiKey =
    typeof extensionProviderSlice?.apiKey === 'string' ? extensionProviderSlice.apiKey : '';
  const extensionModel =
    typeof extensionProviderSlice?.model === 'string' ? extensionProviderSlice.model : '';
  const schemaProviderSlice: Record<string, unknown> = {
    ...(stt.provider === 'alibaba' ? (stt.alibaba ?? {}) : {}),
    ...(stt.provider === 'openai' ? (stt.openai ?? {}) : {}),
    ...(extensionProviderSlice ?? {}),
  };
  const additionalFields = (activeProvider?.fields ?? []).filter(
    (field) => field.key !== 'apiKey' && field.key !== 'model',
  );

  const updateExtensionProvider = useCallback(
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
                  onChange={(e) => updateStt({ provider: e.target.value })}
                >
                  {providerOptions.map((entry) => (
                    <SelectOption key={entry.id} value={entry.id}>
                      {sttProviderLabel(entry.id, v)}
                      {entry.configured ? '' : ' *'}
                    </SelectOption>
                  ))}
                </Select>
              </div>

              <div className={cn('flex flex-col gap-1.5', credentialFieldWidthClass)}>
                <FieldLabel>{v.stt.model}</FieldLabel>
                {stt.provider === 'xopc-local' ? (
                  <Select
                    className={selectClassName()}
                    value={extensionModel || 'sensevoice-small'}
                    onChange={(e) => updateExtensionProvider({ model: e.target.value })}
                  >
                    {(models?.stt?.['xopc-local'] ?? []).map((m) => (
                      <SelectOption key={m.id} value={m.id}>
                        {m.name}
                      </SelectOption>
                    ))}
                  </Select>
                ) : stt.provider === 'alibaba' ? (
                  <Select
                    className={selectClassName()}
                    value={stt.alibaba?.model ?? ''}
                    onChange={(e) => updateSttAlibaba({ model: e.target.value })}
                  >
                    {alibabaModels.map((m) => (
                      <SelectOption key={m.id} value={m.id}>
                        {m.name}
                      </SelectOption>
                    ))}
                  </Select>
                ) : stt.provider === 'openai' ? (
                  <Select
                    className={selectClassName()}
                    value={stt.openai?.model ?? ''}
                    onChange={(e) => updateSttOpenai({ model: e.target.value })}
                  >
                    {openaiModels.map((m) => (
                      <SelectOption key={m.id} value={m.id}>
                        {m.name}
                      </SelectOption>
                    ))}
                  </Select>
                ) : stt.provider === 'groq' ? (
                  <Select
                    className={selectClassName()}
                    value={extensionModel || STT_GROQ_MODELS_FALLBACK[0].id}
                    onChange={(e) => updateExtensionProvider({ model: e.target.value })}
                  >
                    {STT_GROQ_MODELS_FALLBACK.map((m) => (
                      <SelectOption key={m.id} value={m.id}>
                        {m.name}
                      </SelectOption>
                    ))}
                  </Select>
                ) : (
                  <input
                    className={inputClassName()}
                    value={extensionModel}
                    onChange={(e) => updateExtensionProvider({ model: e.target.value })}
                    placeholder={stt.provider}
                  />
                )}
              </div>

              {activeProvider?.diagnostics.requiresApiKey !== false ? (
                <div className={cn('flex flex-col gap-1.5', credentialFieldWidthClass)}>
                  <FieldLabel>{v.stt.apiKey}</FieldLabel>
                  <VoiceApiKeyField
                    kind="stt"
                    providerId={stt.provider}
                    fieldId={`voice-stt-${stt.provider}-api-key`}
                    value={
                      stt.provider === 'alibaba'
                        ? (stt.alibaba?.apiKey ?? '')
                        : stt.provider === 'openai'
                          ? (stt.openai?.apiKey ?? '')
                          : extensionApiKey
                    }
                    onChange={(next) => {
                      if (stt.provider === 'alibaba') updateSttAlibaba({ apiKey: next });
                      else if (stt.provider === 'openai') updateSttOpenai({ apiKey: next });
                      else updateExtensionProvider({ apiKey: next });
                    }}
                    labels={apiKeyLabels}
                    placeholder={stt.provider === 'groq' ? 'gsk_...' : 'sk-...'}
                  />
                  <p className="text-xs text-fg-subtle">
                    {v.stt.apiKeyDesc}
                    {sttEnvHint(stt.provider) ? ` ${sttEnvHint(stt.provider)}` : ''}
                  </p>
                </div>
              ) : null}
            </div>

            {additionalFields.length > 0 ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {additionalFields.map((field) => (
                  <SchemaConfigField
                    key={field.key}
                    field={field}
                    value={readSchemaFieldValue(schemaProviderSlice, field)}
                    onChange={(next) => updateExtensionProvider({ [field.key]: next })}
                    className={field.type === 'textarea' ? 'sm:col-span-2' : credentialFieldWidthClass}
                  />
                ))}
              </div>
            ) : null}

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

            <div className="grid gap-3 rounded-xl bg-surface-hover/50 px-3 py-3 dark:bg-surface-hover/35 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,18rem)] sm:items-center">
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
  updateTtsAlibaba,
  updateTtsOpenai,
  updateTtsEdge,
  updateTtsMinimax,
  updateTtsLocalCli,
}: {
  v: VoiceSettingsMessages;
  apiKeyLabels: VoiceApiKeyFieldLabels;
  tts: VoiceSettingsState['tts'];
  models: VoiceModelsPayload | null;
  ttsProviders: TtsProviderListEntry[];
  updateTts: (p: Partial<VoiceSettingsState['tts']>) => void;
  updateTtsAlibaba: (p: Partial<NonNullable<VoiceSettingsState['tts']['alibaba']>>) => void;
  updateTtsOpenai: (p: Partial<NonNullable<VoiceSettingsState['tts']['openai']>>) => void;
  updateTtsEdge: (p: Partial<NonNullable<VoiceSettingsState['tts']['edge']>>) => void;
  updateTtsMinimax: (p: Partial<NonNullable<VoiceSettingsState['tts']['minimax']>>) => void;
  updateTtsLocalCli: (p: Partial<NonNullable<VoiceSettingsState['tts']['tts-local-cli']>>) => void;
}) {
  const ttsOpenai = models?.tts?.openai?.length ? models.tts.openai : TTS_OPENAI_MODELS_FALLBACK;
  const ttsVoicesOpenai = models?.ttsVoices?.openai?.length ? models.ttsVoices.openai : TTS_OPENAI_VOICES_FALLBACK;
  const ttsAlibaba = models?.tts?.alibaba?.length ? models.tts.alibaba : TTS_ALIBABA_MODELS_FALLBACK;
  const ttsVoicesAlibaba = models?.ttsVoices?.alibaba?.length ? models.ttsVoices.alibaba : TTS_ALIBABA_VOICES_FALLBACK;
  const ttsVoicesEdge = models?.ttsVoices?.edge?.length ? models.ttsVoices.edge : TTS_EDGE_VOICES_FALLBACK;
  const ttsMinimax = models?.tts?.minimax?.length ? models.tts.minimax : TTS_MINIMAX_MODELS_FALLBACK;
  const ttsVoicesMinimax = models?.ttsVoices?.minimax?.length
    ? models.ttsVoices.minimax
    : TTS_MINIMAX_VOICES_FALLBACK;

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
  const providerSlice = tts.providers?.[tts.provider];
  const schemaProviderSlice: Record<string, unknown> = {
    ...(tts.provider === 'openai' ? (tts.openai ?? {}) : {}),
    ...(tts.provider === 'alibaba' ? (tts.alibaba ?? {}) : {}),
    ...(tts.provider === 'edge' ? (tts.edge ?? {}) : {}),
    ...(tts.provider === 'minimax' ? (tts.minimax ?? {}) : {}),
    ...(tts.provider === 'tts-local-cli' ? (tts['tts-local-cli'] ?? {}) : {}),
    ...(providerSlice ?? {}),
  };
  const additionalFields = (activeProvider?.fields ?? []).filter(
    (field) => !['apiKey', 'model', 'voice'].includes(field.key),
  );
  const providerNeedsKey = Boolean(activeProvider?.diagnostics.requiresApiKey);
  const providerReady = Boolean(activeProvider?.configured) || !providerNeedsKey;
  const statusTone = !tts.enabled
    ? 'muted'
    : providerReady
      ? 'ready'
      : 'action';

  const currentModel =
    tts.provider === 'openai'
      ? tts.openai?.model
      : tts.provider === 'alibaba'
        ? tts.alibaba?.model
        : tts.provider === 'minimax'
          ? tts.minimax?.model
          : undefined;
  const currentVoice =
    tts.provider === 'openai'
      ? tts.openai?.voice
      : tts.provider === 'alibaba'
        ? tts.alibaba?.voice
        : tts.provider === 'minimax'
          ? tts.minimax?.voice
          : tts.provider === 'edge'
            ? tts.edge?.voice
            : undefined;

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
        providerConfig: schemaProviderSlice,
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
  }, [currentModel, currentVoice, schemaProviderSlice, stopTestAudio, testText, tts.provider, v.tts.test.emptyText, v.tts.test.playFailed]);

  const updateProviderSlice = useCallback(
    (patch: Record<string, unknown>) => {
      updateTts({
        providers: {
          ...(tts.providers ?? {}),
          [tts.provider]: {
            ...(tts.providers?.[tts.provider] ?? {}),
            ...patch,
          },
        },
      });
    },
    [tts.provider, tts.providers, updateTts],
  );

  const updateSchemaField = useCallback(
    (field: VoiceConfigFieldMetadata, next: unknown) => {
      const patch = { [field.key]: next };
      updateProviderSlice(patch);
      if (tts.provider === 'openai' && field.key === 'baseUrl') {
        updateTtsOpenai(patch);
      } else if (tts.provider === 'minimax' && (field.key === 'baseUrl' || field.key === 'groupId')) {
        updateTtsMinimax(patch);
      } else if (tts.provider === 'edge' && field.key === 'lang') {
        updateTtsEdge(patch);
      }
    },
    [tts.provider, updateProviderSlice, updateTtsEdge, updateTtsMinimax, updateTtsOpenai],
  );

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
              <div className="mt-3 space-y-3">
            {tts.provider === 'openai' ||
            tts.provider === 'alibaba' ||
            tts.provider === 'minimax' ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className={cn('flex flex-col gap-1.5', credentialFieldWidthClass)}>
                  <FieldLabel>{v.stt.apiKey}</FieldLabel>
                  <VoiceApiKeyField
                    kind="tts"
                    providerId={tts.provider}
                    fieldId={`voice-tts-${tts.provider}-api-key`}
                    value={
                      tts.provider === 'openai'
                        ? (tts.openai?.apiKey ?? '')
                        : tts.provider === 'alibaba'
                          ? (tts.alibaba?.apiKey ?? '')
                          : (tts.minimax?.apiKey ?? '')
                    }
                    onChange={(next) => {
                      if (tts.provider === 'openai') updateTtsOpenai({ apiKey: next });
                      else if (tts.provider === 'alibaba') updateTtsAlibaba({ apiKey: next });
                      else updateTtsMinimax({ apiKey: next });
                    }}
                    labels={apiKeyLabels}
                    placeholder={tts.provider === 'minimax' ? 'eyJ...' : 'sk-...'}
                  />
                  <p className="text-xs text-fg-subtle">
                    {v.stt.apiKeyDesc}
                    {ttsEnvHint(tts.provider) ? ` ${ttsEnvHint(tts.provider)}` : ''}
                  </p>
                </div>

                <div className={cn('flex flex-col gap-1.5', credentialFieldWidthClass)}>
                  <FieldLabel>{v.stt.model}</FieldLabel>
                  <Select
                    className={selectClassName()}
                    value={
                      tts.provider === 'openai'
                        ? (tts.openai?.model ?? '')
                        : tts.provider === 'alibaba'
                          ? (tts.alibaba?.model ?? '')
                          : (tts.minimax?.model ?? '')
                    }
                    onChange={(e) => {
                      if (tts.provider === 'openai') updateTtsOpenai({ model: e.target.value });
                      else if (tts.provider === 'alibaba') updateTtsAlibaba({ model: e.target.value });
                      else updateTtsMinimax({ model: e.target.value });
                    }}
                  >
                    {(tts.provider === 'openai'
                      ? ttsOpenai
                      : tts.provider === 'alibaba'
                        ? ttsAlibaba
                        : ttsMinimax
                    ).map((m) => (
                      <SelectOption key={m.id} value={m.id}>
                        {m.name}
                      </SelectOption>
                    ))}
                  </Select>
                </div>

                <div className={cn('flex flex-col gap-1.5', credentialFieldWidthClass)}>
                  <FieldLabel>{v.tts.voice}</FieldLabel>
                  <Select
                    className={selectClassName()}
                    value={
                      tts.provider === 'openai'
                        ? (tts.openai?.voice ?? '')
                        : tts.provider === 'alibaba'
                          ? (tts.alibaba?.voice ?? '')
                          : (tts.minimax?.voice ?? '')
                    }
                    onChange={(e) => {
                      if (tts.provider === 'openai') updateTtsOpenai({ voice: e.target.value });
                      else if (tts.provider === 'alibaba') updateTtsAlibaba({ voice: e.target.value });
                      else updateTtsMinimax({ voice: e.target.value });
                    }}
                  >
                    {(tts.provider === 'openai'
                      ? ttsVoicesOpenai
                      : tts.provider === 'alibaba'
                        ? ttsVoicesAlibaba
                        : ttsVoicesMinimax
                    ).map((m) => (
                      <SelectOption key={m.id} value={m.id}>
                        {m.name}
                      </SelectOption>
                    ))}
                  </Select>
                </div>
              </div>
            ) : null}

            {tts.provider === 'edge' ? (
              <div className={cn('flex flex-col gap-1.5', credentialFieldWidthClass)}>
                <FieldLabel>{v.tts.voice}</FieldLabel>
                <Select
                  className={selectClassName()}
                  value={tts.edge?.voice ?? ''}
                  onChange={(e) => updateTtsEdge({ voice: e.target.value })}
                >
                  {ttsVoicesEdge.map((m) => (
                    <SelectOption key={m.id} value={m.id}>
                      {m.name}
                    </SelectOption>
                  ))}
                </Select>
                <p className="text-xs text-fg-subtle">{v.tts.edgeHint}</p>
              </div>
            ) : null}

            {tts.provider === 'tts-local-cli' ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5 sm:col-span-2">
                  <FieldLabel>{v.tts.localCli.preset}</FieldLabel>
                  <Select
                    className={selectClassName()}
                    value=""
                    onChange={(e) => {
                      const preset = TTS_LOCAL_CLI_PRESETS.find((item) => item.id === e.target.value);
                      if (!preset) return;
                      updateTtsLocalCli({ command: preset.command, outputFormat: preset.outputFormat });
                    }}
                  >
                    <SelectOption value="">{v.tts.localCli.presetPlaceholder}</SelectOption>
                    {TTS_LOCAL_CLI_PRESETS.map((preset) => (
                      <SelectOption key={preset.id} value={preset.id}>
                        {preset.id}
                      </SelectOption>
                    ))}
                  </Select>
                  <p className="text-xs text-fg-subtle">{v.tts.localCli.presetDesc}</p>
                </div>
                <div className="flex flex-col gap-1.5 sm:col-span-2">
                  <FieldLabel>{v.tts.localCli.command}</FieldLabel>
                  <input
                    className={cn(inputClassName(), 'font-mono text-xs')}
                    type="text"
                    autoComplete="off"
                    spellCheck={false}
                    value={tts['tts-local-cli']?.command ?? ''}
                    onChange={(e) => updateTtsLocalCli({ command: e.target.value })}
                    placeholder={v.tts.localCli.commandPlaceholder}
                  />
                  <p className="text-xs text-fg-subtle">{v.tts.localCli.commandDesc}</p>
                </div>
                <div className="flex flex-col gap-1.5">
                  <FieldLabel>{v.tts.localCli.cwd}</FieldLabel>
                  <input
                    className={cn(inputClassName(), 'font-mono text-xs')}
                    type="text"
                    autoComplete="off"
                    spellCheck={false}
                    value={tts['tts-local-cli']?.cwd ?? ''}
                    onChange={(e) => updateTtsLocalCli({ cwd: e.target.value })}
                    placeholder="/path/to/cwd"
                  />
                  <p className="text-xs text-fg-subtle">{v.tts.localCli.cwdDesc}</p>
                </div>
                <div className="flex flex-col gap-1.5">
                  <FieldLabel>{v.tts.localCli.outputFormat}</FieldLabel>
                  <Select
                    className={selectClassName()}
                    value={tts['tts-local-cli']?.outputFormat ?? 'wav'}
                    onChange={(e) =>
                      updateTtsLocalCli({
                        outputFormat: e.target.value as 'mp3' | 'opus' | 'wav',
                      })
                    }
                  >
                    <SelectOption value="wav">wav</SelectOption>
                    <SelectOption value="mp3">mp3</SelectOption>
                    <SelectOption value="opus">opus</SelectOption>
                  </Select>
                  <p className="text-xs text-fg-subtle">{v.tts.localCli.outputFormatDesc}</p>
                </div>
                <div className="flex flex-col gap-1.5 sm:col-span-2">
                  <FieldLabel>{v.tts.localCli.timeoutMs}</FieldLabel>
                  <input
                    className={inputClassName()}
                    type="number"
                    min={0}
                    step={1000}
                    value={
                      typeof tts['tts-local-cli']?.timeoutMs === 'number'
                        ? String(tts['tts-local-cli'].timeoutMs)
                        : ''
                    }
                    onChange={(e) => {
                      const raw = e.target.value.trim();
                      if (raw === '') {
                        updateTtsLocalCli({ timeoutMs: undefined });
                        return;
                      }
                      const num = Number(raw);
                      if (Number.isFinite(num) && num >= 0) {
                        updateTtsLocalCli({ timeoutMs: num });
                      }
                    }}
                    placeholder="30000"
                  />
                  <p className="text-xs text-fg-subtle">{v.tts.localCli.timeoutMsDesc}</p>
                </div>
                <p className="text-xs text-fg-subtle sm:col-span-2">{v.tts.localCli.hint}</p>
              </div>
            ) : null}

            {additionalFields.length > 0 ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {additionalFields.map((field) => (
                  <SchemaConfigField
                    key={field.key}
                    field={field}
                    value={readSchemaFieldValue(schemaProviderSlice, field)}
                    onChange={(next) => updateSchemaField(field, next)}
                    className={field.type === 'textarea' ? 'sm:col-span-2' : credentialFieldWidthClass}
                  />
                ))}
              </div>
            ) : null}
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
