import { ExternalLink, Loader2, Mic, Volume2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { ConfigureWithAILink } from '@/features/settings/configure-with-ai-link';
import { useSaveBarRegistration } from '@/features/settings/save-bar/use-save-bar-registration';
import { useGatewayConfigSwr } from '@/features/gateway/gateway-config-swr';
import {
  fetchVoiceModels,
  normalizeVoiceSettings,
  patchVoiceSettings,
  type VoiceModelsPayload,
  type VoiceSettingsState,
} from '@/features/settings/voice-config-api';
import { apiUrl } from '@/lib/url';
import { nativeSelectMaxWidthClass, selectControlBaseClass, settingsInputFocusClass } from '@/lib/form-field-width';
import { cn } from '@/lib/cn';
import { messages, type VoiceSettingsMessages } from '@/i18n/messages';
import { docsGuidePageUrl } from '@/navigation';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

function inputClassName(): string {
  return cn(
    'w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg',
    'placeholder:text-fg-subtle',
    settingsInputFocusClass,
    'dark:border-edge',
  );
}

function selectClassName(): string {
  return cn(selectControlBaseClass, nativeSelectMaxWidthClass);
}

const STT_ALIBABA_FALLBACK = [
  { id: 'paraformer-v2', name: 'Paraformer v2' },
  { id: 'paraformer-v1', name: 'Paraformer v1' },
];
const STT_OPENAI_FALLBACK = [{ id: 'whisper-1', name: 'Whisper-1' }];
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

/** See `WebSearchSettingsPanel` for the embedded-mode contract. */
export function VoiceSettingsPanel({ embedded = false }: { embedded?: boolean } = {}) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const v = m.voiceSettings;
  const token = useGatewayStore((st) => st.token);
  const hasToken = Boolean(token);

  const [form, setForm] = useState<VoiceSettingsState | null>(null);
  const [baseline, setBaseline] = useState<VoiceSettingsState | null>(null);
  const [models, setModels] = useState<VoiceModelsPayload | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);

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

  useEffect(() => {
    if (!hasToken) {
      setForm(null);
      setBaseline(null);
      setModels(null);
      return;
    }
    if (voiceParsed === null || voiceModels === undefined) return;
    if (!dirty) {
      setForm(structuredClone(voiceParsed));
      setBaseline(structuredClone(voiceParsed));
      setModels(voiceModels);
      setSaveOk(false);
    }
  }, [hasToken, voiceParsed, voiceModels, dirty]);

  const loading = Boolean(
    hasToken &&
      (voiceParsed === null || voiceModels === undefined) &&
      (cfgLoading || vmLoading),
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
            : null;

  const updateStt = useCallback((patch: Partial<VoiceSettingsState['stt']>) => {
    setForm((f) => (f ? { ...f, stt: { ...f.stt, ...patch } } : null));
  }, []);

  const updateSttAlibaba = useCallback((patch: Partial<NonNullable<VoiceSettingsState['stt']['alibaba']>>) => {
    setForm((f) =>
      f
        ? {
            ...f,
            stt: { ...f.stt, alibaba: { ...f.stt.alibaba, ...patch } },
          }
        : null,
    );
  }, []);

  const updateSttOpenai = useCallback((patch: Partial<NonNullable<VoiceSettingsState['stt']['openai']>>) => {
    setForm((f) =>
      f
        ? {
            ...f,
            stt: { ...f.stt, openai: { ...f.stt.openai, ...patch } },
          }
        : null,
    );
  }, []);

  const updateSttFallback = useCallback((patch: Partial<NonNullable<VoiceSettingsState['stt']['fallback']>>) => {
    setForm((f) => {
      if (!f) return null;
      const cur = f.stt.fallback ?? { enabled: true, order: ['alibaba', 'openai'] };
      return {
        ...f,
        stt: {
          ...f.stt,
          fallback: { ...cur, ...patch },
        },
      };
    });
  }, []);

  const updateTts = useCallback((patch: Partial<VoiceSettingsState['tts']>) => {
    setForm((f) => (f ? { ...f, tts: { ...f.tts, ...patch } } : null));
  }, []);

  const updateTtsAlibaba = useCallback((patch: Partial<NonNullable<VoiceSettingsState['tts']['alibaba']>>) => {
    setForm((f) =>
      f
        ? {
            ...f,
            tts: { ...f.tts, alibaba: { ...f.tts.alibaba, ...patch } },
          }
        : null,
    );
  }, []);

  const updateTtsOpenai = useCallback((patch: Partial<NonNullable<VoiceSettingsState['tts']['openai']>>) => {
    setForm((f) =>
      f
        ? {
            ...f,
            tts: { ...f.tts, openai: { ...f.tts.openai, ...patch } },
          }
        : null,
    );
  }, []);

  const updateTtsEdge = useCallback((patch: Partial<NonNullable<VoiceSettingsState['tts']['edge']>>) => {
    setForm((f) =>
      f
        ? {
            ...f,
            tts: { ...f.tts, edge: { ...f.tts.edge, ...patch } },
          }
        : null,
    );
  }, []);

  const updateTtsMinimax = useCallback(
    (patch: Partial<NonNullable<VoiceSettingsState['tts']['minimax']>>) => {
      setForm((f) =>
        f ? { ...f, tts: { ...f.tts, minimax: { ...f.tts.minimax, ...patch } } } : null,
      );
    },
    [],
  );

  const updateTtsLocalCli = useCallback(
    (patch: Partial<NonNullable<VoiceSettingsState['tts']['tts-local-cli']>>) => {
      setForm((f) =>
        f
          ? {
              ...f,
              tts: {
                ...f.tts,
                'tts-local-cli': { ...f.tts['tts-local-cli'], ...patch },
              },
            }
          : null,
      );
    },
    [],
  );

  const save = useCallback(async () => {
    if (!form || saving) return;
    setSaving(true);
    setError(null);
    setSaveOk(false);
    try {
      await patchVoiceSettings(form);
      const next = structuredClone(form);
      setBaseline(next);
      setForm(next);
      setSaveOk(true);
      window.setTimeout(() => setSaveOk(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : v.saveError);
    } finally {
      setSaving(false);
    }
  }, [form, saving, v.saveError]);

  const discard = useCallback(() => {
    if (!baseline) return;
    setForm(structuredClone(baseline));
    setError(null);
    setSaveOk(false);
  }, [baseline]);

  useSaveBarRegistration({ id: 'voice', dirty, saving, save, discard });

  const outerClass = embedded
    ? 'flex flex-col gap-4'
    : 'mx-auto flex w-full max-w-app-main flex-col gap-6 px-4 py-6';
  const compactClass = embedded
    ? 'flex flex-col gap-3'
    : 'mx-auto flex w-full max-w-app-main flex-col gap-3 px-4 py-8';

  if (!hasToken) {
    return (
      <div className={compactClass}>
        {embedded ? null : <h1 className="text-lg font-semibold text-fg">{m.settingsSections.voice}</h1>}
        <p className="text-sm text-fg-muted">{v.needToken}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className={compactClass}>
        <div className="flex items-center gap-2 text-sm text-fg-muted">
          <Loader2 className="size-4 animate-spin" />
          {v.loading}
        </div>
      </div>
    );
  }

  if (!form || models === null) {
    return (
      <div className={compactClass}>
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

  return (
    <div className={outerClass}>
      <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        {embedded ? (
          <div className="min-w-0" aria-hidden />
        ) : (
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-fg">{m.settingsSections.voice}</h1>
            <p className="mt-1 text-sm text-fg-muted">{v.subtitle}</p>
            <a
              href={docsGuidePageUrl(language, 'voice')}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-flex items-center gap-1 text-sm text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              {v.docsLink}
              <ExternalLink className="size-3.5" />
            </a>
          </div>
        )}
        {/* See WebSearchSettingsPanel — global Save bar replaces these in embedded mode. */}
        {embedded ? null : (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            <ConfigureWithAILink skill="setup-voice" />
            {saveOk ? <span className="text-sm text-fg-muted">{v.saved}</span> : null}
            <Button type="button" variant="secondary" disabled={!dirty || saving} onClick={discard}>
              {v.discard}
            </Button>
            <Button type="button" variant="primary" disabled={!dirty || saving} onClick={() => void save()}>
              {saving ? v.saving : v.save}
            </Button>
          </div>
        )}
      </header>

      {dirty && !embedded ? <p className="text-xs text-amber-800 dark:text-amber-200">{v.unsavedHint}</p> : null}
      {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}

      <div className="flex flex-col gap-4">
        <SttSection
          v={v}
          stt={stt}
          models={models}
          updateStt={updateStt}
          updateSttAlibaba={updateSttAlibaba}
          updateSttOpenai={updateSttOpenai}
          updateSttFallback={updateSttFallback}
        />

        <TtsSection
          v={v}
          tts={tts}
          models={models}
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

function SttSection({
  v,
  stt,
  models,
  updateStt,
  updateSttAlibaba,
  updateSttOpenai,
  updateSttFallback,
}: {
  v: VoiceSettingsMessages;
  stt: VoiceSettingsState['stt'];
  models: VoiceModelsPayload | null;
  updateStt: (p: Partial<VoiceSettingsState['stt']>) => void;
  updateSttAlibaba: (p: Partial<NonNullable<VoiceSettingsState['stt']['alibaba']>>) => void;
  updateSttOpenai: (p: Partial<NonNullable<VoiceSettingsState['stt']['openai']>>) => void;
  updateSttFallback: (p: Partial<NonNullable<VoiceSettingsState['stt']['fallback']>>) => void;
}) {
  const alibabaModels = models?.stt?.alibaba?.length ? models.stt.alibaba : STT_ALIBABA_FALLBACK;
  const openaiModels = models?.stt?.openai?.length ? models.stt.openai : STT_OPENAI_FALLBACK;

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
        <div className="flex items-center justify-between gap-2 rounded-xl bg-surface-hover/50 px-3 py-2.5 dark:bg-surface-hover/35">
          <div>
            <div className="text-sm font-medium text-fg">{v.stt.enable}</div>
            <p className="text-xs text-fg-muted">{v.stt.enableDesc}</p>
          </div>
          <input
            type="checkbox"
            className="ui-checkbox"
            checked={stt.enabled}
            onChange={(e) => updateStt({ enabled: e.target.checked })}
          />
        </div>

        {stt.enabled ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <FieldLabel>{v.stt.provider}</FieldLabel>
                <select
                  className={selectClassName()}
                  value={stt.provider}
                  onChange={(e) => updateStt({ provider: e.target.value as 'alibaba' | 'openai' })}
                >
                  <option value="alibaba">{v.stt.alibaba}</option>
                  <option value="openai">{v.stt.openai}</option>
                </select>
              </div>
            </div>

            {stt.provider === 'alibaba' ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <FieldLabel>{v.stt.apiKey}</FieldLabel>
                  <input
                    className={cn(inputClassName(), 'font-mono text-xs')}
                    type="password"
                    autoComplete="off"
                    value={stt.alibaba?.apiKey ?? ''}
                    onChange={(e) => updateSttAlibaba({ apiKey: e.target.value })}
                    placeholder="sk-..."
                  />
                  <p className="text-xs text-fg-subtle">
                    {v.stt.apiKeyDesc} (DASHSCOPE_API_KEY)
                  </p>
                </div>
                <div className="flex flex-col gap-1.5">
                  <FieldLabel>{v.stt.model}</FieldLabel>
                  <select
                    className={selectClassName()}
                    value={stt.alibaba?.model ?? ''}
                    onChange={(e) => updateSttAlibaba({ model: e.target.value })}
                  >
                    {alibabaModels.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <FieldLabel>{v.stt.apiKey}</FieldLabel>
                  <input
                    className={cn(inputClassName(), 'font-mono text-xs')}
                    type="password"
                    autoComplete="off"
                    value={stt.openai?.apiKey ?? ''}
                    onChange={(e) => updateSttOpenai({ apiKey: e.target.value })}
                    placeholder="sk-..."
                  />
                  <p className="text-xs text-fg-subtle">
                    {v.stt.apiKeyDesc} (OPENAI_API_KEY)
                  </p>
                </div>
                <div className="flex flex-col gap-1.5">
                  <FieldLabel>{v.stt.model}</FieldLabel>
                  <select
                    className={selectClassName()}
                    value={stt.openai?.model ?? ''}
                    onChange={(e) => updateSttOpenai({ model: e.target.value })}
                  >
                    {openaiModels.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between gap-2 rounded-xl bg-surface-hover/50 px-3 py-2.5 dark:bg-surface-hover/35">
              <div>
                <div className="text-sm font-medium text-fg">{v.stt.fallback}</div>
                <p className="text-xs text-fg-muted">{v.stt.fallbackDesc}</p>
              </div>
              <input
                type="checkbox"
                className="ui-checkbox"
                checked={stt.fallback?.enabled ?? true}
                onChange={(e) => updateSttFallback({ enabled: e.target.checked })}
              />
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}

function TtsSection({
  v,
  tts,
  models,
  updateTts,
  updateTtsAlibaba,
  updateTtsOpenai,
  updateTtsEdge,
  updateTtsMinimax,
  updateTtsLocalCli,
}: {
  v: VoiceSettingsMessages;
  tts: VoiceSettingsState['tts'];
  models: VoiceModelsPayload | null;
  updateTts: (p: Partial<VoiceSettingsState['tts']>) => void;
  updateTtsAlibaba: (p: Partial<NonNullable<VoiceSettingsState['tts']['alibaba']>>) => void;
  updateTtsOpenai: (p: Partial<NonNullable<VoiceSettingsState['tts']['openai']>>) => void;
  updateTtsEdge: (p: Partial<NonNullable<VoiceSettingsState['tts']['edge']>>) => void;
  updateTtsMinimax: (p: Partial<NonNullable<VoiceSettingsState['tts']['minimax']>>) => void;
  updateTtsLocalCli: (p: Partial<NonNullable<VoiceSettingsState['tts']['tts-local-cli']>>) => void;
}) {
  const triggerDesc = (t: string) => {
    if (t === 'off') return v.tts.triggerDescOff;
    if (t === 'always') return v.tts.triggerDescAlways;
    if (t === 'inbound') return v.tts.triggerDescInbound;
    if (t === 'tagged') return v.tts.triggerDescTagged;
    return '';
  };

  const ttsOpenai = models?.tts?.openai?.length ? models.tts.openai : TTS_OPENAI_MODELS_FALLBACK;
  const ttsVoicesOpenai = models?.ttsVoices?.openai?.length ? models.ttsVoices.openai : TTS_OPENAI_VOICES_FALLBACK;
  const ttsAlibaba = models?.tts?.alibaba?.length ? models.tts.alibaba : TTS_ALIBABA_MODELS_FALLBACK;
  const ttsVoicesAlibaba = models?.ttsVoices?.alibaba?.length ? models.ttsVoices.alibaba : TTS_ALIBABA_VOICES_FALLBACK;
  const ttsVoicesEdge = models?.ttsVoices?.edge?.length ? models.ttsVoices.edge : TTS_EDGE_VOICES_FALLBACK;
  const ttsMinimax = models?.tts?.minimax?.length ? models.tts.minimax : TTS_MINIMAX_MODELS_FALLBACK;
  const ttsVoicesMinimax = models?.ttsVoices?.minimax?.length
    ? models.ttsVoices.minimax
    : TTS_MINIMAX_VOICES_FALLBACK;

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
        <div className="flex items-center justify-between gap-2 rounded-xl bg-surface-hover/50 px-3 py-2.5 dark:bg-surface-hover/35">
          <div>
            <div className="text-sm font-medium text-fg">{v.tts.enable}</div>
            <p className="text-xs text-fg-muted">{v.tts.enableDesc}</p>
          </div>
          <input
            type="checkbox"
            className="ui-checkbox"
            checked={tts.enabled}
            onChange={(e) => updateTts({ enabled: e.target.checked })}
          />
        </div>

        {tts.enabled ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <FieldLabel>{v.tts.trigger}</FieldLabel>
                <select
                  className={selectClassName()}
                  value={tts.trigger}
                  onChange={(e) =>
                    updateTts({ trigger: e.target.value as VoiceSettingsState['tts']['trigger'] })
                  }
                >
                  <option value="off">{v.tts.triggerOff}</option>
                  <option value="always">{v.tts.triggerAlways}</option>
                  <option value="inbound">{v.tts.triggerInbound}</option>
                  <option value="tagged">{v.tts.triggerTagged}</option>
                </select>
                <p className="text-xs text-fg-subtle">{triggerDesc(tts.trigger)}</p>
              </div>
              <div className="flex flex-col gap-1.5">
                <FieldLabel>{v.tts.provider}</FieldLabel>
                <select
                  className={selectClassName()}
                  value={tts.provider}
                  onChange={(e) => updateTts({ provider: e.target.value })}
                >
                  <option value="openai">{v.tts.providerOpenai}</option>
                  <option value="alibaba">{v.stt.alibaba}</option>
                  <option value="minimax">MiniMax</option>
                  <option value="edge">{v.tts.providerEdge}</option>
                  <option value="tts-local-cli">{v.tts.providerLocalCli}</option>
                </select>
              </div>
            </div>

            {tts.provider === 'openai' ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5 sm:col-span-2">
                  <FieldLabel>{v.stt.apiKey}</FieldLabel>
                  <input
                    className={cn(inputClassName(), 'font-mono text-xs')}
                    type="password"
                    autoComplete="off"
                    value={tts.openai?.apiKey ?? ''}
                    onChange={(e) => updateTtsOpenai({ apiKey: e.target.value })}
                    placeholder="sk-..."
                  />
                  <p className="text-xs text-fg-subtle">
                    {v.stt.apiKeyDesc} (OPENAI_API_KEY)
                  </p>
                </div>
                <div className="flex flex-col gap-1.5">
                  <FieldLabel>{v.stt.model}</FieldLabel>
                  <select
                    className={selectClassName()}
                    value={tts.openai?.model ?? ''}
                    onChange={(e) => updateTtsOpenai({ model: e.target.value })}
                  >
                    {ttsOpenai.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <FieldLabel>{v.tts.voice}</FieldLabel>
                  <select
                    className={selectClassName()}
                    value={tts.openai?.voice ?? ''}
                    onChange={(e) => updateTtsOpenai({ voice: e.target.value })}
                  >
                    {ttsVoicesOpenai.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ) : null}

            {tts.provider === 'alibaba' ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5 sm:col-span-2">
                  <FieldLabel>{v.stt.apiKey}</FieldLabel>
                  <input
                    className={cn(inputClassName(), 'font-mono text-xs')}
                    type="password"
                    autoComplete="off"
                    value={tts.alibaba?.apiKey ?? ''}
                    onChange={(e) => updateTtsAlibaba({ apiKey: e.target.value })}
                    placeholder="sk-..."
                  />
                  <p className="text-xs text-fg-subtle">
                    {v.stt.apiKeyDesc} (DASHSCOPE_API_KEY)
                  </p>
                </div>
                <div className="flex flex-col gap-1.5">
                  <FieldLabel>{v.stt.model}</FieldLabel>
                  <select
                    className={selectClassName()}
                    value={tts.alibaba?.model ?? ''}
                    onChange={(e) => updateTtsAlibaba({ model: e.target.value })}
                  >
                    {ttsAlibaba.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <FieldLabel>{v.tts.voice}</FieldLabel>
                  <select
                    className={selectClassName()}
                    value={tts.alibaba?.voice ?? ''}
                    onChange={(e) => updateTtsAlibaba({ voice: e.target.value })}
                  >
                    {ttsVoicesAlibaba.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ) : null}

            {tts.provider === 'minimax' ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5 sm:col-span-2">
                  <FieldLabel>{v.stt.apiKey}</FieldLabel>
                  <input
                    className={cn(inputClassName(), 'font-mono text-xs')}
                    type="password"
                    autoComplete="off"
                    value={tts.minimax?.apiKey ?? ''}
                    onChange={(e) => updateTtsMinimax({ apiKey: e.target.value })}
                    placeholder="eyJ..."
                  />
                  <p className="text-xs text-fg-subtle">{v.stt.apiKeyDesc} (MINIMAX_API_KEY)</p>
                </div>
                <div className="flex flex-col gap-1.5">
                  <FieldLabel>{v.stt.model}</FieldLabel>
                  <select
                    className={selectClassName()}
                    value={tts.minimax?.model ?? ''}
                    onChange={(e) => updateTtsMinimax({ model: e.target.value })}
                  >
                    {ttsMinimax.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <FieldLabel>{v.tts.voice}</FieldLabel>
                  <select
                    className={selectClassName()}
                    value={tts.minimax?.voice ?? ''}
                    onChange={(e) => updateTtsMinimax({ voice: e.target.value })}
                  >
                    {ttsVoicesMinimax.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ) : null}

            {tts.provider === 'edge' ? (
              <div className="flex flex-col gap-1.5">
                <FieldLabel>{v.tts.voice}</FieldLabel>
                <select
                  className={selectClassName()}
                  value={tts.edge?.voice ?? ''}
                  onChange={(e) => updateTtsEdge({ voice: e.target.value })}
                >
                  {ttsVoicesEdge.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-fg-subtle">{v.tts.edgeHint}</p>
              </div>
            ) : null}

            {tts.provider === 'tts-local-cli' ? (
              <div className="grid gap-3 sm:grid-cols-2">
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
                  <select
                    className={selectClassName()}
                    value={tts['tts-local-cli']?.outputFormat ?? 'wav'}
                    onChange={(e) =>
                      updateTtsLocalCli({
                        outputFormat: e.target.value as 'mp3' | 'opus' | 'wav',
                      })
                    }
                  >
                    <option value="wav">wav</option>
                    <option value="mp3">mp3</option>
                    <option value="opus">opus</option>
                  </select>
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
          </>
        ) : null}
      </div>
    </section>
  );
}

function FieldLabel({ children }: { children: ReactNode }) {
  return <div className="text-sm font-medium text-fg">{children}</div>;
}
