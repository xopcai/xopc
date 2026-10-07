import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowRight, ArrowUpRight, ListTodo, MessageCircle, Phone, Settings2, Upload, X } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Skeleton } from '@/components/ui/skeleton';
import { PopoverSelect } from '@/components/ui/popover-select';
import { ChatPage } from '@/features/chat/chat-page';
import { useVoiceCall } from '@/features/voice/realtime/voice-call-context';
import { bumpAgentAvatarCacheRevision } from '@/features/settings/agents/agent-avatar-cache';
import { taskDetailModalHref } from '@/features/tasks/task-detail-route';
import { fetchJson } from '@/lib/fetch';
import { formatMediumDate } from '@/lib/date-formatters';
import { apiUrl } from '@/lib/url';
import { useLocaleStore } from '@/stores/locale-store';
import { usePageHeaderStore } from '@/stores/page-header-store';
import { PersonalAvatar, type PersonalAppearance } from './personal-avatar';

type Preferences = {
  addressAs?: string;
  warmth?: 'reserved' | 'balanced' | 'gentle';
  humor?: 'none' | 'occasional' | 'playful';
  supportMode?: 'listen' | 'untangle' | 'solutions';
  detailLevel?: 'brief' | 'balanced' | 'detailed';
  proactivity?: 'decisions' | 'important' | 'open';
};
type PersonalAgent = {
  agentId: string;
  conversationId: string;
  state: 'provisioning' | 'ready' | 'error';
  displayName: string;
  appearance: PersonalAppearance;
  preferences: Preferences;
  revision: number;
  errorMessage: string | null;
};
type ModelOption = { id: string; name: string };
type ApiResult<T> = { ok: boolean; payload: T };
type Activity = { items: Array<{ id: string; title: string; phase: string; runStatus?: string; updatedAt: number }>; total: number };
type ActivityItem = Activity['items'][number];
const ACTIVITY_PAGE_SIZE = 5;

function activityTitle(title: string): string {
  const normalized = title.replace(/\s+/g, ' ').trim();
  if (normalized.length <= 58) return normalized;
  const withoutAside = normalized.replace(/（[^）]{1,80}）|\([^)]{1,80}\)/g, '')
    .replace(/([A-Za-z0-9])(?=[\u4e00-\u9fff])/g, '$1 ').replace(/\s+/g, ' ').trim();
  const lead = withoutAside.split(/[。！？；;，]/, 1)[0]?.trim() || withoutAside;
  return lead.length > 58 ? `${lead.slice(0, 57).trimEnd()}…` : lead;
}

function activityStatus(item: ActivityItem, zh: boolean): { label: string; tone: string } {
  if (item.phase === 'closed') return { label: zh ? '已结束' : 'Finished', tone: 'bg-fg-subtle' };
  if (item.runStatus === 'running') return { label: zh ? '正在执行' : 'Working', tone: 'bg-accent' };
  if (item.runStatus === 'queued') return { label: zh ? '等待开始' : 'Queued', tone: 'bg-fg-subtle' };
  if (item.runStatus === 'failed') return { label: zh ? '需要关注' : 'Needs attention', tone: 'bg-danger' };
  if (item.runStatus === 'waiting') return { label: zh ? '等待继续' : 'Waiting', tone: 'bg-warning' };
  if (item.runStatus === 'verifying' || item.runStatus === 'succeeded' || item.phase === 'review') return { label: zh ? '等待验收' : 'In review', tone: 'bg-warning' };
  if (item.runStatus === 'cancelled') return { label: zh ? '已暂停' : 'Stopped', tone: 'bg-fg-subtle' };
  if (item.phase === 'active') return { label: zh ? '正在推进' : 'In progress', tone: 'bg-accent' };
  if (item.phase === 'ready') return { label: zh ? '准备开始' : 'Ready', tone: 'bg-fg-subtle' };
  return { label: zh ? '待处理' : 'Planned', tone: 'bg-fg-subtle' };
}

function ActivityRow({ item, zh }: { item: ActivityItem; zh: boolean }) {
  const status = activityStatus(item, zh);
  return <Link to={taskDetailModalHref('/personal', item.id)} className="group flex min-w-0 items-start gap-3 rounded-2xl bg-surface-panel px-4 py-4 transition-colors duration-150 hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
    <span className={`mt-2 size-1.5 shrink-0 rounded-full ${status.tone}`} aria-hidden />
    <span className="min-w-0 flex-1">
      <span className="line-clamp-2 break-words text-sm font-medium leading-5 text-fg">{activityTitle(item.title)}</span>
      <span className="mt-1.5 flex items-center gap-2 text-xs text-fg-muted"><span>{status.label}</span><span className="text-fg-subtle" aria-hidden>·</span><span>{formatMediumDate(item.updatedAt, zh ? 'zh' : 'en')}</span></span>
    </span>
    <ArrowUpRight className="mt-0.5 size-4 shrink-0 text-fg-subtle opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden />
  </Link>;
}

const STYLE_OPTIONS = [
  { id: 'direct', warmth: 'reserved', zh: '直接清楚', en: 'Clear and direct', zhExample: '先说结论，再说明下一步。', enExample: 'Lead with the answer, then the next step.' },
  { id: 'natural', warmth: 'balanced', zh: '自然有分寸', en: 'Natural and measured', zhExample: '说清重点，也留出必要的解释。', enExample: 'Cover the point, with enough context to act.' },
  { id: 'gentle', warmth: 'gentle', zh: '温和耐心', en: 'Warm and patient', zhExample: '语气柔和一些，仍然把事情说清楚。', enExample: 'Be gentle while keeping the answer clear.' },
] as const;

const APPEARANCES = [
  { id: 'loopi', zh: '小环', en: 'Loopi', color: 'bg-slate-100/50 dark:bg-slate-400/10' },
  { id: 'loopi-curious', zh: '好奇', en: 'Curious', color: 'bg-blue-100/50 dark:bg-blue-400/10' },
  { id: 'loopi-care', zh: '温和', en: 'Gentle', color: 'bg-violet-100/50 dark:bg-violet-400/10' },
] as const;

function appearanceFor(id: PersonalAgent['appearance']) {
  return APPEARANCES.find(item => item.id === id) ?? APPEARANCES[0];
}

function openingFor(preferences: Preferences, zh: boolean): string {
  if (preferences.warmth === 'reserved') return zh
    ? '你可以直接说目标或问题。我会先给结论，需要时再展开。'
    : 'Tell me the goal or question. I’ll lead with the answer and expand when useful.';
  if (preferences.warmth === 'gentle') return zh
    ? '想聊一件事，或让我帮你推进工作，都可以从这里开始。我会认真听，也会把下一步说清楚。'
    : 'You can talk something through or ask me to move work forward. I’ll listen carefully and make the next step clear.';
  return zh
    ? '有什么想讨论或推进的事？直接告诉我就好。'
    : 'What would you like to discuss or move forward? Just tell me what is on your mind.';
}

function responsePreviewFor(warmth: Preferences['warmth'], supportMode: Preferences['supportMode'], zh: boolean): string {
  if (supportMode === 'listen') {
    if (warmth === 'reserved') return zh ? '先说说这三件事。我听完再帮你排顺序。' : 'Tell me about the three tasks first. I’ll listen, then help order them.';
    if (warmth === 'gentle') return zh ? '可以，慢慢说说每件事现在到哪一步。等你说完，我们再一起排顺序。' : 'Take your time telling me where each task stands. Once you’re done, we can sort the order together.';
    return zh ? '你先说说三件事各自到哪一步。我听完再和你一起排顺序。' : 'Tell me where each task stands. I’ll listen first, then help you order them.';
  }
  if (supportMode === 'solutions') {
    if (warmth === 'reserved') return zh ? '列出三件事和截止时间。我直接给你建议顺序与依据。' : 'List the three tasks and deadlines. I’ll give you a suggested order and why.';
    if (warmth === 'gentle') return zh ? '把三件事和截止时间告诉我。我先帮你排出一个可行顺序，再解释为什么。' : 'Tell me the three tasks and deadlines. I’ll suggest a workable order and explain why.';
    return zh ? '把三件事和截止时间发我，我会给出建议顺序和理由。' : 'Send me the three tasks and deadlines. I’ll suggest an order and explain why.';
  }
  if (warmth === 'reserved') return zh
    ? '列出三件事、截止时间和影响范围。我帮你排优先级。'
    : 'List the three tasks, deadlines, and impact. I’ll rank them.';
  if (warmth === 'gentle') return zh
    ? '我们先把三件事放到一起看。告诉我各自的截止时间，我帮你理清先后。'
    : 'Let’s look at the three together. Tell me their deadlines, and I’ll help sort the order.';
  return zh
    ? '可以。把三件事和截止时间发我，我们先找出最该做的一件。'
    : 'Sure. Send me the three tasks and deadlines, and we’ll identify the one to start with.';
}

function styleId(preferences: Preferences): string {
  return STYLE_OPTIONS.find(option => option.warmth === preferences.warmth)?.id ?? 'natural';
}

export function PersonalPage() {
  const voiceCall = useVoiceCall();
  const voiceCallRef = useRef(voiceCall);
  voiceCallRef.current = voiceCall;
  const zh = useLocaleStore(state => state.language) === 'zh';
  const setPageHeader = usePageHeaderStore(state => state.setPageHeader);
  const clearPageHeader = usePageHeaderStore(state => state.clearPageHeader);
  const [record, setRecord] = useState<PersonalAgent | null>(null);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedStyle, setSelectedStyle] = useState('natural');
  const [appearance, setAppearance] = useState<PersonalAppearance>('loopi');
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [displayName, setDisplayName] = useState('');
  const [addressAs, setAddressAs] = useState('');
  const [supportMode, setSupportMode] = useState<Preferences['supportMode']>('untangle');
  const [humor, setHumor] = useState<Preferences['humor']>('none');
  const [detailLevel, setDetailLevel] = useState<Preferences['detailLevel']>('balanced');
  const [proactivity, setProactivity] = useState<Preferences['proactivity']>('decisions');
  const [showSettings, setShowSettings] = useState(false);
  const [showActivity, setShowActivity] = useState(false);
  const [activity, setActivity] = useState<Activity | null>(null);
  const [activityError, setActivityError] = useState(false);
  const [activityLoadingMore, setActivityLoadingMore] = useState(false);
  const [activityMoreError, setActivityMoreError] = useState(false);
  const [activityLoadedCount, setActivityLoadedCount] = useState(0);
  const activityRequestRef = useRef(0);
  const openSettings = useCallback(() => {
    setShowActivity(false);
    setShowSettings(true);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [personal, compatible] = await Promise.all([
        fetchJson<ApiResult<PersonalAgent | null>>(apiUrl('/api/personal-agent')),
        fetchJson<ApiResult<ModelOption[]>>(apiUrl('/api/personal-agent/models')),
      ]);
      setRecord(personal.payload);
      window.dispatchEvent(new CustomEvent('personal-agent-updated', { detail: personal.payload }));
      if (personal.payload) window.dispatchEvent(new Event('session-updated'));
      setModels(compatible.payload);
      if (personal.payload) {
        setDisplayName(personal.payload.displayName);
        setAppearance(personal.payload.appearance);
        setSelectedStyle(styleId(personal.payload.preferences));
        setAddressAs(personal.payload.preferences.addressAs ?? '');
        setSupportMode(personal.payload.preferences.supportMode ?? 'untangle');
        setHumor(personal.payload.preferences.humor ?? 'none');
        setDetailLevel(personal.payload.preferences.detailLevel ?? 'balanced');
        setProactivity(personal.payload.preferences.proactivity ?? 'decisions');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const saveStyle = async (nextRecord: PersonalAgent, name: string, style: string) => {
    const option = STYLE_OPTIONS.find(item => item.id === style) ?? STYLE_OPTIONS[1];
    const response = await fetchJson<ApiResult<PersonalAgent>>(apiUrl('/api/personal-agent/profile'), {
      method: 'PATCH',
      body: JSON.stringify({
        revision: nextRecord.revision,
        displayName: name.trim() || nextRecord.displayName,
        appearance,
        preferences: { ...nextRecord.preferences, addressAs: addressAs.trim() || undefined, supportMode, detailLevel, proactivity,
          warmth: option.warmth, humor },
      }),
    });
    setRecord(response.payload);
    window.dispatchEvent(new CustomEvent('personal-agent-updated', { detail: response.payload }));
  };

  const create = async () => {
    if (models.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetchJson<ApiResult<PersonalAgent>>(apiUrl('/api/personal-agent'), {
        method: 'POST', body: JSON.stringify({}),
      });
      setRecord(response.payload);
      window.dispatchEvent(new CustomEvent('personal-agent-updated', { detail: response.payload }));
      window.dispatchEvent(new Event('session-updated'));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const openActivity = useCallback(async () => {
    const request = ++activityRequestRef.current;
    setShowActivity(true);
    setActivity(null);
    setActivityError(false);
    setActivityLoadingMore(false);
    setActivityMoreError(false);
    setActivityLoadedCount(0);
    try {
      const response = await fetchJson<ApiResult<Activity>>(apiUrl(`/api/personal-agent/activity?limit=${ACTIVITY_PAGE_SIZE}&offset=0`));
      if (request !== activityRequestRef.current) return;
      setActivity(response.payload);
      setActivityLoadedCount(response.payload.items.length);
    } catch {
      if (request === activityRequestRef.current) setActivityError(true);
    }
  }, []);

  const loadMoreActivity = useCallback(async () => {
    if (!activity || activityLoadingMore || activityLoadedCount >= activity.total) return;
    const request = activityRequestRef.current;
    setActivityLoadingMore(true);
    setActivityMoreError(false);
    try {
      const response = await fetchJson<ApiResult<Activity>>(apiUrl(`/api/personal-agent/activity?limit=${ACTIVITY_PAGE_SIZE}&offset=${activityLoadedCount}`));
      if (request !== activityRequestRef.current) return;
      setActivity(previous => previous ? {
        total: response.payload.total,
        items: [...previous.items, ...response.payload.items.filter(item => !previous.items.some(existing => existing.id === item.id))],
      } : response.payload);
      setActivityLoadedCount(previous => previous + response.payload.items.length);
    } catch {
      if (request === activityRequestRef.current) setActivityMoreError(true);
    } finally {
      if (request === activityRequestRef.current) setActivityLoadingMore(false);
    }
  }, [activity, activityLoadedCount, activityLoadingMore]);

  const save = async () => {
    if (!record) return;
    setBusy(true);
    setError(null);
    try {
      await saveStyle(record, displayName, selectedStyle);
      setShowSettings(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const uploadAvatar = async (file: File) => {
    if (!record || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setError(zh ? '请选择 PNG、JPEG 或 WebP 图片。' : 'Choose a PNG, JPEG, or WebP image.');
      return;
    }
    if (file.size === 0 || file.size > 512 * 1024) {
      setError(zh ? '图片大小不能超过 512 KB。' : 'Image must be 512 KB or smaller.');
      return;
    }
    setUploadingAvatar(true);
    setError(null);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      await fetchJson<ApiResult<{ agentId: string }>>(apiUrl(`/api/agents/${encodeURIComponent(record.agentId)}/avatar`), {
        method: 'PUT',
        body: JSON.stringify({ base64: dataUrl.slice(dataUrl.indexOf(',') + 1), mimeType: file.type }),
      });
      bumpAgentAvatarCacheRevision(record.agentId);
      setAppearance('custom');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setUploadingAvatar(false);
    }
  };

  useLayoutEffect(() => {
    const ready = record?.state === 'ready';
    const avatar = ready ? record.appearance : appearance;
    const title = ready ? record.displayName : 'Ada';
    setPageHeader({
      startExtra: null,
      main: <div className="flex min-w-0 items-center gap-2.5">
        {ready ? (
          <button type="button" onClick={openSettings} className="touch-target -m-1 shrink-0 rounded-full p-1 transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" aria-label={zh ? `编辑${title}的资料` : `Edit ${title}'s profile`} title={zh ? '编辑 Personal AI' : 'Edit Personal AI'}>
            <span className="flex size-8 items-center justify-center"><PersonalAvatar appearance={avatar} agentId={record?.agentId} className="size-8" /></span>
          </button>
        ) : <span className="flex size-8 shrink-0 items-center justify-center"><PersonalAvatar appearance={avatar} agentId={record?.agentId} className="size-8" /></span>}
        <h1 className="min-w-0 truncate text-sm font-semibold text-fg sm:text-base">{title}</h1>
      </div>,
      end: ready ? <div className="flex items-center gap-1">
          <button type="button" disabled={voiceCall.active} onClick={() => {
            if (record?.state === 'ready') voiceCallRef.current.open({ conversationId: record.conversationId, name: record.displayName, mode: 'assistant' });
          }} className="touch-target rounded-lg p-2 text-fg-muted hover:bg-surface-hover hover:text-fg disabled:opacity-50" aria-label={zh ? '语音通话' : 'Voice call'} title={zh ? '语音通话' : 'Voice call'}><Phone className="size-5" /></button>
          <button type="button" onClick={() => void openActivity()} aria-pressed={showActivity} className="touch-target rounded-lg p-2 text-fg-muted hover:bg-surface-hover hover:text-fg" aria-label={zh ? '正在做的事' : 'Activity'}><ListTodo className="size-5" /></button>
          <button type="button" onClick={openSettings} className="touch-target rounded-lg p-2 text-fg-muted hover:bg-surface-hover hover:text-fg" aria-label={zh ? '回应偏好' : 'Response preferences'}><Settings2 className="size-5" /></button>
        </div> : null,
    });
    return () => clearPageHeader();
  }, [appearance, clearPageHeader, openActivity, openSettings, record, setPageHeader, showActivity, voiceCall.active, zh]);

  function renderSettingsDrawer() {
    return (
      <Dialog.Root open={showSettings} onOpenChange={setShowSettings}>
        <Dialog.Portal>
          <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[80] bg-scrim backdrop-blur-[2px]" />
          <Dialog.Content aria-describedby={undefined} className="xopc-drawer-right fixed right-0 top-0 z-[81] flex h-dvh w-full max-w-[42rem] flex-col overflow-hidden border-l border-edge bg-surface-overlay shadow-popover outline-none">
            <div className="flex shrink-0 items-start justify-between gap-4 border-b border-edge px-5 py-4 sm:px-6">
              <div className="min-w-0">
                <Dialog.Title className="text-lg font-semibold text-fg">{zh ? '编辑 Personal AI' : 'Edit Personal AI'}</Dialog.Title>
                <p className="mt-1 text-sm text-fg-muted">{zh ? '调整回应方式、称呼与形象' : 'Adjust responses, name, and appearance'}</p>
              </div>
              <Dialog.Close className="touch-target -mr-2 -mt-1 rounded-lg p-2 text-fg-muted hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" aria-label={zh ? '关闭编辑' : 'Close editor'}><X className="size-5" /></Dialog.Close>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-6 sm:px-6">
              <div className="mx-auto max-w-2xl">
                <div className="rounded-2xl border border-edge bg-surface-panel p-5 sm:p-6">
                  <div className="text-sm font-medium text-fg">{zh ? '回答的语气' : 'Response tone'}</div>
                  <p className="mt-1 text-xs text-fg-muted">{zh ? '选一个起点；每次对话仍会按具体情况调整。' : 'Choose a starting point. Each reply still adapts to the situation.'}</p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    {STYLE_OPTIONS.map(option => <button key={option.id} type="button" onClick={() => setSelectedStyle(option.id)} aria-pressed={selectedStyle === option.id} className={`min-h-28 rounded-xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${selectedStyle === option.id ? 'border-accent bg-accent/5' : 'border-edge hover:bg-surface-hover'}`}>
                      <span className="flex items-center gap-2 font-medium text-fg"><MessageCircle className="size-4 text-accent" aria-hidden />{zh ? option.zh : option.en}</span>
                      <span className="mt-2 block text-xs leading-relaxed text-fg-muted">{zh ? option.zhExample : option.enExample}</span>
                    </button>)}
                  </div>
                  <div className="mt-6 text-sm font-medium text-fg">{zh ? '遇到棘手的问题时，希望先得到什么？' : 'When a problem is tricky, what helps first?'}</div>
                  <div className="mt-3 flex flex-wrap gap-2">{([
                    ['listen', zh ? '先听我说' : 'Listen first'],
                    ['untangle', zh ? '帮我理清' : 'Help me untangle it'],
                    ['solutions', zh ? '直接给办法' : 'Give me solutions'],
                  ] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={supportMode === value} onClick={() => setSupportMode(value)} className={`min-h-11 rounded-full border px-4 text-sm ${supportMode === value ? 'border-accent bg-accent/5 text-fg' : 'border-edge text-fg-muted hover:bg-surface-hover'}`}>{label}</button>)}</div>
                  <div className="mt-6 grid gap-5 sm:grid-cols-2">
                    <div><p className="mb-2 text-sm font-medium text-fg">{zh ? '回答多详细' : 'Answer length'}</p><PopoverSelect value={detailLevel ?? 'balanced'} options={[
                      { value: 'brief', label: zh ? '简短，先说结论' : 'Brief, answer first' },
                      { value: 'balanced', label: zh ? '适中' : 'Balanced' },
                      { value: 'detailed', label: zh ? '多解释一点' : 'More detail' },
                    ]} placeholder={zh ? '选择回答长度' : 'Choose answer length'} allowEmpty={false} onChange={value => setDetailLevel(value as Preferences['detailLevel'])} /></div>
                    <div><p className="mb-2 text-sm font-medium text-fg">{zh ? '主动更新的频率' : 'Proactive updates'}</p><PopoverSelect value={proactivity ?? 'decisions'} options={[
                      { value: 'decisions', label: zh ? '只说结果和决定' : 'Results and decisions only' },
                      { value: 'important', label: zh ? '重要进展也告诉我' : 'Important milestones too' },
                      { value: 'open', label: zh ? '可以多提建议' : 'More suggestions' },
                    ]} placeholder={zh ? '选择主动程度' : 'Choose check-in style'} allowEmpty={false} onChange={value => setProactivity(value as Preferences['proactivity'])} /></div>
                  </div>
                  <details className="mt-5 text-sm text-fg-muted"><summary className="cursor-pointer select-none">{zh ? '更多表达偏好' : 'More expression preferences'}</summary><div className="mt-3 max-w-xs"><p className="mb-2 font-medium text-fg">{zh ? '轻松程度' : 'Lightness'}</p><PopoverSelect value={humor ?? 'none'} options={[
                    { value: 'none', label: zh ? '不加玩笑' : 'No jokes' },
                    { value: 'occasional', label: zh ? '合适时轻松一点' : 'A light touch when it fits' },
                    { value: 'playful', label: zh ? '可以更活泼' : 'More playful' },
                  ]} placeholder={zh ? '选择轻松程度' : 'Choose lightness'} allowEmpty={false} onChange={value => setHumor(value as Preferences['humor'])} /></div></details>
                  <div className="mt-6 rounded-2xl border border-edge bg-surface-base p-4" aria-live="polite">
                    <p className="text-xs font-medium text-fg-muted">{zh ? '语气与支持方式预览' : 'Tone and support preview'}</p>
                    <p className="mt-3 text-sm text-fg-muted">{zh ? '你：我手上有三件事，不知道先做哪件。' : 'You: I have three things to do and don’t know where to start.'}</p>
                    <div className="mt-2 flex items-start gap-3"><span className={`flex size-8 shrink-0 items-center justify-center rounded-full ${appearanceFor(appearance).color}`}><PersonalAvatar appearance={appearance} agentId={record?.agentId} className="size-8" /></span><p className="rounded-2xl rounded-tl-sm bg-surface-hover px-4 py-3 text-sm leading-relaxed text-fg">{responsePreviewFor(STYLE_OPTIONS.find(item => item.id === selectedStyle)?.warmth, supportMode, zh)}</p></div>
                  </div>
                  <div className="mt-7 border-t border-edge pt-6"><h3 className="text-sm font-medium text-fg">{zh ? '称呼与形象（可选）' : 'Name and appearance (optional)'}</h3><p className="mt-1 text-xs text-fg-muted">{zh ? '名称与称呼可随时修改；界面形象不决定回答语气。' : 'Names can change anytime; appearance does not determine response tone.'}</p></div>
                  <div className="mt-5 grid gap-4 sm:grid-cols-2">
                    <div><label htmlFor="personal-name" className="block text-sm font-medium text-fg">{zh ? '助手名称' : 'Assistant name'}</label><input id="personal-name" value={displayName} onChange={event => setDisplayName(event.target.value)} maxLength={60} placeholder="Ada" className="mt-2 w-full rounded-xl border border-edge bg-surface-base px-3 py-2.5 text-fg outline-none focus-visible:ring-2 focus-visible:ring-accent" /></div>
                    <div><label htmlFor="personal-address" className="block text-sm font-medium text-fg">{zh ? '怎么称呼你' : 'What should it call you?'}</label><input id="personal-address" value={addressAs} onChange={event => setAddressAs(event.target.value)} maxLength={60} placeholder={zh ? '可留空' : 'Optional'} className="mt-2 w-full rounded-xl border border-edge bg-surface-base px-3 py-2.5 text-fg outline-none focus-visible:ring-2 focus-visible:ring-accent" /></div>
                  </div>
                  <div className="mt-5 text-sm font-medium text-fg">{zh ? '界面形象' : 'On-screen appearance'}</div>
                  <div className="mt-3 flex flex-wrap gap-3">{APPEARANCES.map(item => <button key={item.id} type="button" onClick={() => setAppearance(item.id)} aria-pressed={appearance === item.id} className={`flex min-h-16 min-w-20 items-center gap-2 rounded-xl px-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${appearance === item.id ? 'bg-accent/10' : 'bg-surface-hover hover:bg-surface-active'}`}><span className={`flex size-8 items-center justify-center rounded-full ${item.color}`}><PersonalAvatar appearance={item.id} className="size-8" /></span><span className="text-xs text-fg-muted">{zh ? item.zh : item.en}</span></button>)}
                    <input ref={avatarInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" aria-label={zh ? '上传头像' : 'Upload avatar'} onChange={event => {
                      const file = event.currentTarget.files?.[0];
                      if (file) void uploadAvatar(file);
                      event.currentTarget.value = '';
                    }} />
                    <button type="button" disabled={uploadingAvatar} onClick={() => avatarInputRef.current?.click()} aria-pressed={appearance === 'custom'} className={`flex min-h-16 min-w-20 items-center gap-2 rounded-xl px-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50 ${appearance === 'custom' ? 'bg-accent/10' : 'bg-surface-hover hover:bg-surface-active'}`}><span className="flex size-8 items-center justify-center rounded-full bg-surface-panel">{appearance === 'custom' ? <PersonalAvatar appearance="custom" agentId={record?.agentId} className="size-8" /> : <Upload className="size-4 text-fg-muted" aria-hidden />}</span><span className="text-xs text-fg-muted">{uploadingAvatar ? (zh ? '上传中…' : 'Uploading…') : (zh ? '上传图片' : 'Upload')}</span></button>
                  </div>
                </div>
                <p className="mt-5 text-center text-sm text-fg-muted">{zh ? '之后可以直接说“回答短一点”或“先听我说”，回应方式会继续调整。' : 'You can later say “keep it shorter” or “listen first” to adjust how it responds.'}</p>
              </div>
            </div>
            <div className="shrink-0 border-t border-edge bg-surface-overlay px-5 py-4 sm:px-6">
              {error && <p role="alert" className="mb-3 text-sm text-danger">{error}</p>}
              <button type="button" disabled={busy || uploadingAvatar} onClick={() => void save()} className="min-h-11 w-full rounded-xl bg-accent px-4 py-2.5 font-medium text-white disabled:opacity-50">{busy ? (zh ? '正在保存…' : 'Saving…') : (zh ? '保存回应偏好' : 'Save response preferences')}</button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }

  if (loading) return <div className="mx-auto w-full max-w-2xl space-y-5 px-6 py-12"><Skeleton className="h-20 w-20 rounded-full" /><Skeleton className="h-9 w-72" /><Skeleton className="h-44 w-full rounded-2xl" /></div>;

  if (record?.state === 'ready') return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-surface-panel">
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1"><ChatPage embedded personal personalWelcome={{ name: record.displayName, addressAs: record.preferences.addressAs, avatar: <PersonalAvatar appearance={record.appearance} agentId={record.agentId} className="size-14" />, opening: openingFor(record.preferences, zh) }} conversationId={record.conversationId} /></div>
        {showActivity && <aside className="fixed inset-0 z-30 flex min-w-0 flex-col bg-surface-inset shadow-lg sm:static sm:w-[min(25rem,42vw)] sm:shadow-none" aria-label={zh ? '派发的任务' : 'Delegated tasks'}>
          <div className="flex shrink-0 items-start justify-between gap-3 px-6 pb-3 pt-6">
            <div className="min-w-0"><h2 className="text-base font-semibold tracking-tight text-fg">{zh ? '交给我推进的事' : 'Delegated work'}</h2><p className="mt-1 text-xs text-fg-muted">{activity ? (zh ? `最近更新 · 共 ${activity.total} 项` : `Recently updated · ${activity.total} total`) : (zh ? '查看任务进展与结果' : 'Follow progress and results')}</p></div>
            <button type="button" onClick={() => setShowActivity(false)} className="touch-target -mr-2 -mt-1 rounded-lg p-2 text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" aria-label={zh ? '关闭活动' : 'Close activity'}><X className="size-4" /></button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-5 pt-3">
            {!activity && !activityError && <div className="space-y-2"><Skeleton className="h-18 rounded-2xl" /><Skeleton className="h-18 rounded-2xl" /><Skeleton className="h-18 rounded-2xl" /></div>}
            {activityError && <div className="px-5 py-12 text-center"><p className="text-sm text-fg-muted">{zh ? '暂时无法读取任务' : 'Could not load tasks'}</p><button type="button" onClick={() => void openActivity()} className="mt-3 rounded-lg px-3 py-2 text-sm text-accent hover:bg-surface-hover">{zh ? '重试' : 'Try again'}</button></div>}
            {activity?.items.length === 0 && <div className="px-5 py-16 text-center"><ListTodo className="mx-auto size-7 text-fg-subtle" aria-hidden /><p className="mt-4 text-sm font-medium text-fg">{zh ? '还没有派发的任务' : 'No delegated work yet'}</p><p className="mt-1 text-xs leading-5 text-fg-muted">{zh ? '你可以在对话里直接告诉我想推进的事。' : 'Tell me what you would like to move forward in chat.'}</p></div>}
            {activity && activity.items.length > 0 && <div className="space-y-2">{activity.items.map(item => <ActivityRow key={item.id} item={item} zh={zh} />)}</div>}
            {activity && activityLoadedCount < activity.total && <div className="pt-4 text-center">
              <button type="button" onClick={() => void loadMoreActivity()} disabled={activityLoadingMore} className="min-h-10 rounded-xl bg-surface-panel px-5 text-sm font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg disabled:opacity-50">{activityLoadingMore ? (zh ? '正在加载…' : 'Loading…') : (zh ? '加载更多' : 'Load more')}</button>
              {activityMoreError && <p role="alert" className="mt-2 text-xs text-danger">{zh ? '加载失败，请重试' : 'Could not load more. Try again.'}</p>}
            </div>}
          </div>
        </aside>}
      </div>
      {showSettings && renderSettingsDrawer()}
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-1 items-center justify-center overflow-y-auto bg-surface-base px-5 py-10 sm:px-8">
      <div className="w-full max-w-lg text-center">
        <div className="mx-auto flex size-20 items-center justify-center rounded-[1.75rem] bg-surface-hover">
          <PersonalAvatar appearance="loopi" className="size-16" />
        </div>
        <h2 className="mt-7 text-3xl font-semibold tracking-tight text-fg">{zh ? '有事，直接和我说' : 'Start with a conversation'}</h2>
        <p className="mx-auto mt-3 max-w-md text-sm leading-7 text-fg-muted">{zh
          ? '聊想法、问问题，或交给我一件要推进的事。我们先从对话开始，回应方式可以边聊边调整。'
          : 'Bring a question, an idea, or something to move forward. We can shape how I respond as we talk.'}</p>
        <button type="button" disabled={busy || models.length === 0} onClick={() => void create()}
          className="mx-auto mt-8 flex min-h-12 w-full max-w-xs items-center justify-center gap-2 rounded-xl bg-accent px-5 text-sm font-medium text-white transition-colors hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:opacity-50">
          {busy ? (zh ? '正在准备对话…' : 'Getting ready…') : (zh ? '开始对话' : 'Start chatting')}
          {!busy && <ArrowRight className="size-4" aria-hidden />}
        </button>
        {models.length === 0 && <p className="mt-5 text-sm text-fg-muted">{zh ? '开始前需要配置一个可用模型。' : 'Set up a compatible model to get started.'} <Link to="/settings/capabilities/models" className="text-accent underline underline-offset-2">{zh ? '前往模型设置' : 'Model settings'}</Link></p>}
        {error && <p role="alert" className="mt-5 text-sm text-danger">{error}</p>}
        {models.length > 0 && <p className="mt-5 text-xs text-fg-subtle">{zh ? '名字、形象和其他偏好，以后都能随时调整。' : 'You can change the name, appearance, and preferences later.'}</p>}
      </div>
    </div>
  );


}
