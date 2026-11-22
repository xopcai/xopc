import { useCallback, useEffect, useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { Link } from 'react-router-dom';
import useSWR from 'swr';
import type { VoiceCallPreferencesPatch } from '@xopcai/realtime-protocol/voice';

import { Skeleton } from '@/components/ui/skeleton';
import { bumpAgentAvatarCacheRevision } from '@/features/settings/agents/agent-avatar-cache';
import { bosonVoiceSettingsUrl, fetchBosonVoiceSettings } from '@/features/settings/voice-config-api';
import { cn } from '@/lib/cn';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { PersonalAvatar, type PersonalAppearance } from './personal-avatar';
import { PersonalCallSettings } from './personal-call-settings';
import { PersonalModelSetting } from './personal-model-setting';
import type { PersonalAgent } from './personal-page';
import { PersonalVoiceSetting } from './personal-voice-setting';

type ApiResult<T> = { ok: boolean; payload: T };
type ProfileChanges = {
  displayName?: string;
  appearance?: PersonalAppearance;
  voicePreference?: PersonalAgent['voicePreference'];
  voiceCallPreferences?: VoiceCallPreferencesPatch;
  messageReactionsEnabled?: boolean;
};

const APPEARANCES = [
  { id: 'loopi', zh: 'Loopi', en: 'Loopi', color: 'bg-slate-100/50 dark:bg-slate-400/10' },
  { id: 'loopi-curious', zh: '好奇', en: 'Curious', color: 'bg-blue-100/50 dark:bg-blue-400/10' },
  { id: 'loopi-care', zh: '温和', en: 'Gentle', color: 'bg-violet-100/50 dark:bg-violet-400/10' },
] as const;

export function PersonalProfileSettings({ zh, onOpenVoiceServices, showMessageReactions = false, compact = false }: {
  zh: boolean;
  onOpenVoiceServices?: () => void;
  showMessageReactions?: boolean;
  compact?: boolean;
}) {
  const [record, setRecord] = useState<PersonalAgent | null>(null);
  const recordRef = useRef<PersonalAgent | null>(null);
  const profileUpdateQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const [loading, setLoading] = useState(true);
  const [savingCount, setSavingCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [appearance, setAppearance] = useState<PersonalAppearance>('loopi');
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [displayName, setDisplayName] = useState('');
  const [showAppearanceChoices, setShowAppearanceChoices] = useState(false);
  const refresh = useCallback(async () => {
    setError(null);
    try {
      const response = await fetchJson<ApiResult<PersonalAgent | null>>(apiUrl('/api/personal-agent'));
      const previous = recordRef.current;
      recordRef.current = response.payload;
      setRecord(response.payload);
      if (response.payload) {
        if (response.payload.displayName !== previous?.displayName) setDisplayName(response.payload.displayName);
        if (response.payload.appearance !== previous?.appearance) setAppearance(response.payload.appearance);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const updateProfile = (event: Event) => {
      const next = (event as CustomEvent<PersonalAgent | null>).detail;
      if (!next) return;
      if (next.displayName !== recordRef.current?.displayName) setDisplayName(next.displayName);
      if (next.appearance !== recordRef.current?.appearance) setAppearance(next.appearance);
      recordRef.current = next;
      setRecord(next);
    };
    window.addEventListener('personal-agent-updated', updateProfile);
    return () => window.removeEventListener('personal-agent-updated', updateProfile);
  }, []);
  useEffect(() => {
    if (!showMessageReactions) return;
    const onReactionPreference = (event: Event) => {
      const detail = (event as CustomEvent<{ conversationId: string; enabled: boolean }>).detail;
      if (!detail || detail.conversationId !== recordRef.current?.conversationId) return;
      profileUpdateQueueRef.current = profileUpdateQueueRef.current.then(() => {
        if (detail.enabled !== recordRef.current?.messageReactionsEnabled) return refresh();
      });
    };
    window.addEventListener('session-agent-reaction-preference', onReactionPreference);
    return () => window.removeEventListener('session-agent-reaction-preference', onReactionPreference);
  }, [refresh, showMessageReactions]);
  const { data: boson, error: bosonError } = useSWR(record?.state === 'ready' ? apiUrl(bosonVoiceSettingsUrl) : null, fetchBosonVoiceSettings);

  const queueProfileUpdate = useCallback((changes: ProfileChanges, lockFields = true): Promise<boolean> => {
    if (lockFields) setSavingCount(count => count + 1);
    setError(null);
    const update = profileUpdateQueueRef.current.then(async () => {
      const current = recordRef.current;
      if (!current) return false;
      const displayName = changes.displayName?.trim() || current.displayName;
      const appearance = changes.appearance ?? current.appearance;
      const voicePreference = changes.voicePreference === undefined ? current.voicePreference : changes.voicePreference;
      if (displayName === current.displayName && appearance === current.appearance
        && JSON.stringify(voicePreference) === JSON.stringify(current.voicePreference)
        && (changes.messageReactionsEnabled === undefined || changes.messageReactionsEnabled === current.messageReactionsEnabled)
        && !changes.voiceCallPreferences) return true;
      try {
        const response = await fetchJson<ApiResult<PersonalAgent>>(apiUrl('/api/personal-agent/profile'), {
          method: 'PATCH',
          body: JSON.stringify({ revision: current.revision, displayName, appearance,
            ...(changes.voicePreference !== undefined ? { voicePreference } : {}),
            ...(changes.messageReactionsEnabled !== undefined ? { messageReactionsEnabled: changes.messageReactionsEnabled } : {}),
            ...(changes.voiceCallPreferences ? { voiceCallPreferences: changes.voiceCallPreferences } : {}) }),
        });
        recordRef.current = response.payload;
        setRecord(response.payload);
        window.dispatchEvent(new CustomEvent('personal-agent-updated', { detail: response.payload }));
        return true;
      } catch (cause) {
        if (cause instanceof Error && 'status' in cause && cause.status === 409) await refresh();
        setError(cause instanceof Error ? cause.message : String(cause));
        return false;
      }
    }).finally(() => { if (lockFields) setSavingCount(count => count - 1); });
    profileUpdateQueueRef.current = update;
    return update;
  }, [refresh]);

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
      setShowAppearanceChoices(false);
      await queueProfileUpdate({ appearance: 'custom' });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setUploadingAvatar(false);
    }
  };

  if (loading) return <div className={compact ? 'space-y-3' : 'space-y-4'}><Skeleton className={compact ? 'h-11 w-full' : 'h-20 w-full'} /><Skeleton className="h-48 w-full" /></div>;
  if (record?.state !== 'ready') return <div className="space-y-3 text-sm text-fg-muted">
    {error ? <p role="alert">{error}</p> : null}
    <Link to="/personal" className="text-accent hover:underline">{zh ? '前往 Ada 完成设置' : 'Finish setting up Ada'}</Link>
    {error ? <button type="button" onClick={() => void refresh()} className="ml-3 text-accent hover:underline">{zh ? '重试' : 'Retry'}</button> : null}
  </div>;
  const messageReactionsLabel = zh ? '消息表情' : 'Message reactions';
  const messageReactionsEnabled = record.messageReactionsEnabled === true;
  const sectionSpacing = compact ? 'space-y-3' : 'space-y-5';
  return <section className={sectionSpacing} aria-label={zh ? 'Ada 助手设置' : 'Ada assistant settings'}>
    <div className={cn('flex items-center', compact ? 'gap-2' : 'flex-col')}>
      <button type="button" disabled={uploadingAvatar} onClick={() => setShowAppearanceChoices(open => !open)} aria-expanded={showAppearanceChoices} aria-controls="personal-appearance-options" aria-label={zh ? '选择头像' : 'Choose avatar'} className="shrink-0 rounded-full transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50">
        <PersonalAvatar appearance={appearance} agentId={record.agentId} className={compact ? 'size-11' : 'size-16'} />
      </button>
      <input id="personal-name" aria-label={zh ? '助手名称' : 'Assistant name'}
        value={displayName} onChange={event => setDisplayName(event.target.value)}
        onBlur={event => {
          const next = event.currentTarget.value.trim();
          if (next) { setDisplayName(next); void queueProfileUpdate({ displayName: next }); }
          else setDisplayName(recordRef.current?.displayName ?? '');
        }}
        onKeyDown={event => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') {
            event.currentTarget.value = recordRef.current?.displayName ?? '';
            setDisplayName(event.currentTarget.value);
            event.currentTarget.blur();
          }
        }} maxLength={60} placeholder="Ada"
        className={cn('w-full min-w-0 rounded-lg border border-transparent bg-transparent px-2 py-1 font-semibold text-fg outline-none transition-colors hover:border-edge focus:border-edge focus:bg-surface-base focus-visible:ring-2 focus-visible:ring-accent',
          compact ? 'text-sm' : 'mt-2 text-center text-lg')} />
    </div>
    <div className={sectionSpacing}>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        {showAppearanceChoices && <section id="personal-appearance-options">
          <h3 className="mb-3 text-sm font-medium text-fg">{zh ? '形象' : 'Appearance'}</h3>
          <div className="grid grid-cols-4 gap-2">{APPEARANCES.map(item => <button key={item.id} type="button" onClick={() => { setAppearance(item.id); setShowAppearanceChoices(false); void queueProfileUpdate({ appearance: item.id }); }} aria-pressed={appearance === item.id} className={`flex min-w-0 flex-col items-center gap-1.5 rounded-xl px-1 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${appearance === item.id ? 'bg-accent/10 ring-1 ring-accent/40' : 'bg-surface-panel hover:bg-surface-hover'}`}><span className={`flex size-8 items-center justify-center rounded-full ${item.color}`}><PersonalAvatar appearance={item.id} className="size-8" /></span><span className="truncate text-xs text-fg-muted">{zh ? item.zh : item.en}</span></button>)}
            <input ref={avatarInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" aria-label={zh ? '上传头像' : 'Upload avatar'} onChange={event => {
              const file = event.currentTarget.files?.[0];
              if (file) void uploadAvatar(file);
              event.currentTarget.value = '';
            }} />
            <button type="button" disabled={uploadingAvatar} onClick={() => avatarInputRef.current?.click()} aria-pressed={appearance === 'custom'} className={`flex min-w-0 flex-col items-center gap-1.5 rounded-xl px-1 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50 ${appearance === 'custom' ? 'bg-accent/10 ring-1 ring-accent/40' : 'bg-surface-panel hover:bg-surface-hover'}`}><span className="flex size-8 items-center justify-center rounded-full bg-surface-panel">{appearance === 'custom' ? <PersonalAvatar appearance="custom" agentId={record.agentId} className="size-8" /> : <Upload className="size-4 text-fg-muted" aria-hidden />}</span><span className="truncate text-xs text-fg-muted">{uploadingAvatar ? (zh ? '上传中…' : 'Uploading…') : (zh ? '上传' : 'Upload')}</span></button>
          </div>
        </section>}
        <PersonalModelSetting conversationId={record.conversationId} zh={zh} onSaved={async () => {
          const response = await fetchJson<ApiResult<PersonalAgent | null>>(apiUrl('/api/personal-agent'));
          if (response.ok && response.payload) { recordRef.current = response.payload; setRecord(response.payload); }
        }} />
        {showMessageReactions && <div className="flex min-h-12 items-center justify-between gap-4 rounded-xl border border-edge px-4">
          <span className="text-sm font-medium text-fg">{messageReactionsLabel}</span>
          <button type="button" role="switch" aria-label={messageReactionsLabel} aria-checked={messageReactionsEnabled}
            disabled={savingCount > 0}
            onClick={() => void queueProfileUpdate({ messageReactionsEnabled: !messageReactionsEnabled })}
            className="group touch-target flex shrink-0 items-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60">
            <span aria-hidden className="flex h-6 w-11 items-center rounded-full bg-fg-muted/30 p-0.5 transition-colors group-aria-checked:bg-accent motion-reduce:transition-none">
              <span className="size-5 rounded-full bg-white transition-transform group-aria-checked:translate-x-5 motion-reduce:transition-none" />
            </span>
          </button>
        </div>}
        <PersonalCallSettings preferences={record.voiceCallPreferences} settings={boson} failed={Boolean(bosonError)} disabled={savingCount > 0} zh={zh} onOpenServices={onOpenVoiceServices}
          onChange={voiceCallPreferences => queueProfileUpdate({ voiceCallPreferences }, voiceCallPreferences.enginePreference === undefined)}>
          {active => <PersonalVoiceSetting active={active} onOpenServices={onOpenVoiceServices} onGreetingChange={openingGreetingEnabled => queueProfileUpdate({ voiceCallPreferences: { openingGreetingEnabled } }, false)} record={record} zh={zh} onSelectVoice={voicePreference => queueProfileUpdate({ voicePreference })} />}
        </PersonalCallSettings>
      </div>
  </section>;
}
