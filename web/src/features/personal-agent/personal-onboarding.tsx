import { ArrowLeft, ArrowRight, Check, Play, Upload } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { Skeleton } from '@/components/ui/skeleton';
import { fetchComposioConnectorCatalog, fetchConnectorInstances, type ConnectorDefinition, type ConnectorInstance } from '@/features/connectors/connectors-api';
import { ConnectorLogo } from '@/features/connectors/components/connector-logo';
import { InstallConnectorDialog } from '@/features/connectors/components/install-connector-dialog';
import { buildInitialDraft, type InstallDraft } from '@/features/connectors/components/install-connector-draft';
import { previewRealtimeVoice, fetchRealtimeVoiceStatus, fetchTtsVoices } from '@/features/settings/voice-config-api';
import { PcmPlayer } from '@/features/voice/realtime/pcm-player';
import { messages } from '@/i18n/messages';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { useLocaleStore } from '@/stores/locale-store';
import { bumpAgentAvatarCacheRevision } from '@/features/settings/agents/agent-avatar-cache';

import { PersonalAvatar, type PersonalAppearance } from './personal-avatar';
import type { PersonalAgent } from './personal-page';

type Step = 'intro' | 'identity' | 'voice' | 'connections';
type Preset = Exclude<PersonalAppearance, 'custom'>;
type Draft = { displayName: string; appearance: Preset; voice: string | null };
type Voice = { id: string; name: string; description?: string; style?: string };
const STEPS: Step[] = ['intro', 'identity', 'voice', 'connections'];
const PRESETS: Array<{ id: Preset; zh: string; en: string }> = [
  { id: 'loopi', zh: '小环', en: 'Loopi' },
  { id: 'loopi-curious', zh: '好奇', en: 'Curious' },
  { id: 'loopi-care', zh: '温和', en: 'Gentle' },
];

function isConnected(instance: ConnectorInstance | undefined): boolean {
  return Boolean(instance?.enabled && (instance.status === 'connected' || instance.connectionStatus === 'connected' || instance.authStatus === 'connected'));
}

async function uploadAvatar(agentId: string, file: File): Promise<void> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  await fetchJson(apiUrl(`/api/agents/${encodeURIComponent(agentId)}/avatar`), {
    method: 'PUT',
    body: JSON.stringify({ base64: dataUrl.slice(dataUrl.indexOf(',') + 1), mimeType: file.type }),
  });
  bumpAgentAvatarCacheRevision(agentId);
}

export function PersonalOnboarding({ modelsAvailable, onCreated }: {
  modelsAvailable: boolean;
  onCreated: (record: PersonalAgent, avatarUploadFailed: boolean) => void;
}) {
  const zh = useLocaleStore(state => state.language) === 'zh';
  const language = useLocaleStore(state => state.language);
  const [step, setStep] = useState<Step>('intro');
  const [draft, setDraft] = useState<Draft>({ displayName: 'Ada', appearance: 'loopi', voice: null });
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [voiceRoute, setVoiceRoute] = useState<{ provider: string; model: string; enabled: boolean } | null>(null);
  const [voiceLoading, setVoiceLoading] = useState(true);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [playing, setPlaying] = useState<string | null>(null);
  const playerRef = useRef<PcmPlayer | null>(null);
  const previewAbortRef = useRef<AbortController | null>(null);
  const [connectors, setConnectors] = useState<ConnectorDefinition[]>([]);
  const [connectorsLoading, setConnectorsLoading] = useState(true);
  const [instances, setInstances] = useState<ConnectorInstance[]>([]);
  const [installDraft, setInstallDraft] = useState<InstallDraft | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchJson<{ payload: { step: Step; draft: Draft } }>(apiUrl('/api/personal-agent/onboarding'))
      .then(result => { if (!cancelled) { setStep(result.payload.step); setDraft(result.payload.draft); } })
      .catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause)); })
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const timer = window.setTimeout(() => {
      void fetchJson(apiUrl('/api/personal-agent/onboarding'), {
        method: 'PUT', body: JSON.stringify({ step, draft }),
      }).catch(() => {});
    }, 350);
    return () => window.clearTimeout(timer);
  }, [draft, loaded, step]);

  useEffect(() => {
    let cancelled = false;
    void fetchRealtimeVoiceStatus().then(status => {
      if (cancelled) return;
      if (status.tts && status.enabled) setVoiceRoute({ provider: status.tts.provider, model: status.tts.model, enabled: true });
      else setVoiceLoading(false);
    }).catch(() => { if (!cancelled) setVoiceLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!voiceRoute?.enabled) return;
    let cancelled = false;
    void fetchTtsVoices(voiceRoute.provider, voiceRoute.model, 'realtime')
      .then(items => { if (!cancelled) setVoices(items.slice(0, 12)); }).catch(() => {})
      .finally(() => { if (!cancelled) setVoiceLoading(false); });
    return () => { cancelled = true; };
  }, [voiceRoute]);

  useEffect(() => {
    if (step !== 'connections') return;
    let cancelled = false;
    setConnectorsLoading(true);
    void Promise.allSettled([
      fetchComposioConnectorCatalog({ page: 1, pageSize: 24, verification: 'verified' }),
      fetchConnectorInstances(),
    ]).then(([catalog, current]) => {
      if (cancelled) return;
      if (catalog.status === 'fulfilled') {
        const preferred = ['gmail', 'googlecalendar', 'googledrive', 'github', 'linear'];
        setConnectors(catalog.value.connectors.filter(item => item.runtime.type === 'composio' && preferred.includes(item.runtime.toolkit)).sort((a, b) => preferred.indexOf(a.runtime.type === 'composio' ? a.runtime.toolkit : '') - preferred.indexOf(b.runtime.type === 'composio' ? b.runtime.toolkit : '')));
      }
      if (current.status === 'fulfilled') setInstances(current.value);
      setConnectorsLoading(false);
    });
    return () => { cancelled = true; };
  }, [step]);

  useEffect(() => () => {
    previewAbortRef.current?.abort();
    void playerRef.current?.close();
  }, []);
  useEffect(() => () => { if (avatarPreview) URL.revokeObjectURL(avatarPreview); }, [avatarPreview]);

  const saveDraft = async (nextStep: Step, nextDraft = draft) => {
    await fetchJson(apiUrl('/api/personal-agent/onboarding'), {
      method: 'PUT', body: JSON.stringify({ step: nextStep, draft: nextDraft }),
    });
    setStep(nextStep);
  };

  const go = async (direction: 1 | -1) => {
    setError(null);
    const next = STEPS[Math.max(0, Math.min(STEPS.length - 1, STEPS.indexOf(step) + direction))];
    try { await saveDraft(next); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };

  const create = async (defaults = false) => {
    if (!modelsAvailable || busy) return;
    setBusy(true);
    setError(null);
    try {
      const chosen = defaults ? { displayName: 'Ada', appearance: 'loopi' as Preset, voice: null } : draft;
      const voicePreference = chosen.voice && voiceRoute?.enabled && voices.some(item => item.id === chosen.voice)
        ? { provider: voiceRoute.provider, model: voiceRoute.model, voice: chosen.voice } : undefined;
      const response = await fetchJson<{ payload: PersonalAgent }>(apiUrl('/api/personal-agent'), {
        method: 'POST', body: JSON.stringify({ displayName: chosen.displayName.trim() || 'Ada', appearance: chosen.appearance, ...(voicePreference ? { voicePreference } : {}) }),
      });
      let record = response.payload;
      let avatarUploadFailed = false;
      if (!defaults && avatarFile) {
        try {
          await uploadAvatar(record.agentId, avatarFile);
          const updated = await fetchJson<{ payload: PersonalAgent }>(apiUrl('/api/personal-agent/profile'), {
            method: 'PATCH', body: JSON.stringify({ revision: record.revision, displayName: record.displayName, appearance: 'custom', preferences: record.preferences }),
          });
          record = updated.payload;
        } catch { avatarUploadFailed = true; }
      }
      onCreated(record, avatarUploadFailed);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(false); }
  };

  const play = useCallback(async (voice: string) => {
    previewAbortRef.current?.abort();
    void playerRef.current?.close();
    const controller = new AbortController();
    previewAbortRef.current = controller;
    setPlaying(voice);
    setError(null);
    try {
      const player = new PcmPlayer();
      playerRef.current = player;
      await player.start();
      const audio = await previewRealtimeVoice(controller.signal, voice);
      if (controller.signal.aborted) return;
      player.enqueue(audio, () => setPlaying(null));
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
      setPlaying(null);
    }
  }, []);

  if (!loaded) return <div className="mx-auto w-full max-w-xl space-y-4 px-6 py-14"><Skeleton className="h-10 w-2/3" /><Skeleton className="h-64 w-full rounded-2xl" /><Skeleton className="h-12 w-full rounded-xl" /></div>;
  const stepIndex = STEPS.indexOf(step);
  const title = {
    intro: zh ? '创建一个和你一起做事的助手' : 'Create an assistant to work with you',
    identity: zh ? '先给它一个形象和名字' : 'Choose a look and a name',
    voice: zh ? '想让我用什么声音回应？' : 'How should your assistant sound?',
    connections: zh ? '要让我了解哪些信息？' : 'What information can your assistant use?',
  }[step];

  return <div className="flex h-full min-h-0 flex-col bg-surface-base">
    <header className="shrink-0 px-5 pt-5 sm:px-8 sm:pt-7">
      <div className="mx-auto w-full max-w-2xl">
        <div className="flex min-h-10 items-center justify-between gap-4">
          {stepIndex > 0 ? <button type="button" disabled={busy} onClick={() => void go(-1)} className="-ml-2 inline-flex min-h-10 items-center gap-1.5 rounded-lg px-2 text-sm text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"><ArrowLeft className="size-4" />{zh ? '上一步' : 'Back'}</button>
            : <span className="text-sm font-medium text-fg-muted">{zh ? '设置我的助手' : 'Set up my assistant'}</span>}
          <Link to="/chat" className="-mr-2 inline-flex min-h-10 items-center rounded-lg px-2 text-sm text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">{zh ? '稍后继续' : 'Finish later'}</Link>
        </div>
        <div className="mt-4 grid grid-cols-4 gap-1.5" role="progressbar" aria-label={zh ? '设置进度' : 'Setup progress'} aria-valuenow={stepIndex + 1} aria-valuemin={1} aria-valuemax={STEPS.length}>
          {STEPS.map((item, index) => <span key={item} className={`h-1 rounded-full transition-colors duration-200 ${index <= stepIndex ? 'bg-accent' : 'bg-surface-active'}`} />)}
        </div>
      </div>
    </header>
    <main className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-8 sm:px-8">
      <div key={step} className="mx-auto my-auto w-full max-w-2xl py-6 motion-safe:animate-[page-enter_220ms_ease-out]">
        <div className="mb-8 flex items-center gap-4">
          <span className="flex size-16 shrink-0 items-center justify-center rounded-2xl bg-surface-hover">{avatarPreview ? <img src={avatarPreview} alt="" className="size-14 rounded-xl object-cover" /> : <PersonalAvatar appearance={draft.appearance} className="size-14" />}</span>
          <div><p className="text-xs text-fg-muted">{zh ? '我的助手' : 'My assistant'}</p><p className="mt-1 text-lg font-semibold text-fg">{draft.displayName || 'Ada'}</p></div>
        </div>
        <p className="mb-3 text-xs font-medium tracking-wide text-fg-subtle">{zh ? `第 ${stepIndex + 1} 步 · 共 ${STEPS.length} 步` : `Step ${stepIndex + 1} of ${STEPS.length}`}</p>
        <h1 className="text-2xl font-semibold tracking-tight text-fg sm:text-3xl">{title}</h1>
        {step === 'intro' && <div className="mt-6 max-w-xl space-y-3 text-base leading-8 text-fg-muted">
          <p>{zh ? '你可以找它讨论问题，也可以交给它一件要推进的事。' : 'Talk through a question or give it something to move forward.'}</p>
          <p>{zh ? '需要深入处理时，它会找合适的 Agent，并把进展带回对话。' : 'It can ask a suitable Agent for deeper work and bring the progress back.'}</p>
          <p>{zh ? '它能使用哪些数据和设备，由你决定。' : 'You choose which data and devices it can use.'}</p>
        </div>}
        {step === 'identity' && <div className="mt-7 space-y-7">
          <label className="block text-sm font-medium text-fg">{zh ? '助手名字' : 'Assistant name'}<input value={draft.displayName} maxLength={60} onChange={event => setDraft(current => ({ ...current, displayName: event.target.value }))} onBlur={() => setDraft(current => ({ ...current, displayName: current.displayName.trim() || 'Ada' }))} className="mt-2 block w-full rounded-xl border border-edge bg-surface-panel px-4 py-3 text-fg outline-none focus-visible:ring-2 focus-visible:ring-accent" /></label>
          <div><p className="mb-3 text-sm font-medium text-fg">{zh ? '选择头像' : 'Choose an avatar'}</p><div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{PRESETS.map(item => <button key={item.id} type="button" aria-pressed={!avatarFile && draft.appearance === item.id} onClick={() => { setAvatarFile(null); setAvatarPreview(null); setDraft(current => ({ ...current, appearance: item.id })); }} className={`flex min-h-28 flex-col items-center justify-center gap-2 rounded-2xl p-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${!avatarFile && draft.appearance === item.id ? 'bg-accent/10 text-fg ring-1 ring-accent/40' : 'bg-surface-panel text-fg-muted hover:bg-surface-hover'}`}><PersonalAvatar appearance={item.id} className="size-14" />{zh ? item.zh : item.en}</button>)}<label className={`flex min-h-28 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl p-3 text-sm transition-colors focus-within:ring-2 focus-within:ring-accent ${avatarFile ? 'bg-accent/10 text-fg ring-1 ring-accent/40' : 'bg-surface-panel text-fg-muted hover:bg-surface-hover'}`}><Upload className="size-6" />{zh ? '上传图片' : 'Upload image'}<input className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" onChange={event => { const file = event.target.files?.[0]; if (!file) return; if (file.size > 512 * 1024 || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { setError(zh ? '请选择不超过 512 KB 的 PNG、JPEG 或 WebP 图片。' : 'Choose a PNG, JPEG, or WebP image under 512 KB.'); return; } setAvatarFile(file); setAvatarPreview(URL.createObjectURL(file)); }} /></label></div><p className="mt-2 text-xs text-fg-subtle">{zh ? '自定义图片在创建助手时上传；刷新后需要重新选择。' : 'Custom images upload when you create the assistant; select again after a refresh.'}</p></div>
        </div>}
        {step === 'voice' && <div className="mt-5"><p className="text-sm leading-6 text-fg-muted">{zh ? '用于这个助手的语音通话；文字回答不受影响。试听不会使用麦克风。' : 'This affects calls with this assistant. Text stays the same. Preview does not use your microphone.'}</p>{voiceLoading ? <div className="mt-5 grid gap-3 sm:grid-cols-2"><Skeleton className="h-20 rounded-xl" /><Skeleton className="h-20 rounded-xl" /></div> : voiceRoute?.enabled && voices.length > 0 ? <div className="mt-5 grid gap-3 sm:grid-cols-2"><button type="button" aria-pressed={!draft.voice} onClick={() => setDraft(current => ({ ...current, voice: null }))} className={`rounded-xl p-4 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${!draft.voice ? 'bg-accent/10 text-fg ring-1 ring-accent/40' : 'bg-surface-panel text-fg-muted hover:bg-surface-hover'}`}>{zh ? '使用默认声音' : 'Use the default voice'}</button>{voices.map(voice => <div key={voice.id} className={`flex items-center gap-2 rounded-xl p-3 transition-colors ${draft.voice === voice.id ? 'bg-accent/10 ring-1 ring-accent/40' : 'bg-surface-panel hover:bg-surface-hover'}`}><button type="button" className="min-w-0 flex-1 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" aria-pressed={draft.voice === voice.id} onClick={() => setDraft(current => ({ ...current, voice: voice.id }))}><span className="block text-sm font-medium text-fg">{voice.name}</span><span className="mt-1 block text-xs text-fg-muted">{voice.description || voice.style || (zh ? '点击选择' : 'Select this voice')}</span></button><button type="button" onClick={() => void play(voice.id)} className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-hover text-fg hover:bg-surface-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" aria-label={zh ? `试听${voice.name}` : `Preview ${voice.name}`}><Play className={`size-4 ${playing === voice.id ? 'text-accent' : ''}`} /></button></div>)}</div> : <div className="mt-5 rounded-xl bg-surface-panel p-5 text-sm text-fg-muted"><p>{zh ? '当前没有可试听的语音。你可以先用文字对话，稍后再设置。' : 'No voice is ready to preview. You can start with text and set it up later.'}</p><Link to="/settings/capabilities/voice?returnTo=%2Fpersonal" className="mt-3 inline-block text-accent hover:underline">{zh ? '设置语音服务' : 'Set up voice'}</Link></div>}</div>}
        {step === 'connections' && <div className="mt-5"><p className="text-sm leading-6 text-fg-muted">{zh ? '现在连接，或进入对话后再添加。连接不会自动读取历史数据或创建持续关注。' : 'Connect now or add sources later. Connecting does not automatically scan history or create ongoing monitoring.'}</p>{connectorsLoading ? <div className="mt-5 space-y-2"><Skeleton className="h-18 rounded-xl" /><Skeleton className="h-18 rounded-xl" /></div> : <div className="mt-5 space-y-2">{connectors.length ? connectors.map(connector => { const connected = isConnected(instances.find(item => item.connectorId === connector.id)); return <div key={connector.id} className="flex items-center gap-3 rounded-xl bg-surface-panel p-4"><ConnectorLogo connector={connector} size="sm" /><div className="min-w-0 flex-1"><p className="text-sm font-medium text-fg">{connector.displayName}</p><p className="line-clamp-2 text-xs text-fg-muted">{connector.description}</p></div>{connected ? <span className="flex items-center gap-1 text-xs text-success"><Check className="size-4" />{zh ? '已连接' : 'Connected'}</span> : <button type="button" onClick={() => setInstallDraft(buildInitialDraft(connector))} className="rounded-lg bg-surface-hover px-3 py-2 text-xs text-fg transition-colors hover:bg-surface-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">{zh ? '连接' : 'Connect'}</button>}</div>; }) : <p className="rounded-xl bg-surface-panel p-5 text-sm text-fg-muted">{zh ? '暂无可用的推荐服务；你仍可直接进入对话。' : 'No suggested services are available. You can continue to chat.'}</p>}</div>}</div>}
        {!modelsAvailable && <p className="mt-5 rounded-xl bg-warning/5 p-4 text-sm text-fg-muted">{zh ? '开始前需要一个可用模型。' : 'A compatible model is required before you start.'} <Link to="/settings/capabilities/models" className="text-accent underline">{zh ? '配置模型' : 'Set up a model'}</Link></p>}
        {error && <p role="alert" className="mt-5 text-sm text-danger">{error}</p>}
      </div>
    </main>
    <footer className="shrink-0 px-5 pb-6 pt-3 sm:px-8 sm:pb-9"><div className="mx-auto flex w-full max-w-2xl flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between"><span className="text-xs text-fg-subtle">{zh ? '这些选择以后都能调整' : 'You can change these choices later'}</span><div className="flex flex-wrap items-center gap-3">{step === 'intro' && <button type="button" disabled={!modelsAvailable || busy} onClick={() => void create(true)} className="min-h-11 rounded-lg px-3 text-sm text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40">{zh ? '用默认设置开始' : 'Use defaults'}</button>}{step === 'voice' && <button type="button" onClick={() => { const nextDraft = { ...draft, voice: null }; setDraft(nextDraft); setError(null); void saveDraft('connections', nextDraft).catch(cause => setError(cause instanceof Error ? cause.message : String(cause))); }} className="min-h-11 rounded-lg px-3 text-sm text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">{zh ? '跳过' : 'Skip'}</button>}<button type="button" disabled={busy || (step === 'connections' && !modelsAvailable)} onClick={() => step === 'connections' ? void create() : void go(1)} className="flex min-h-11 items-center gap-2 rounded-xl bg-accent px-5 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:opacity-40">{busy ? (zh ? '正在创建…' : 'Creating…') : step === 'connections' ? (zh ? '进入对话' : 'Start chatting') : (zh ? '继续' : 'Continue')} {!busy && <ArrowRight className="size-4" />}</button></div></div></footer>
    {installDraft && <InstallConnectorDialog draft={installDraft} onChange={setInstallDraft} onClose={() => setInstallDraft(null)} t={messages(language).connectorsSettings} onInstalled={async () => { setInstances(await fetchConnectorInstances()); setInstallDraft(null); }} />}
  </div>;
}
