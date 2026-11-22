import * as Dialog from '@radix-ui/react-dialog';
import { Loader2, RotateCcw, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { useChatSessionStore } from '@/features/chat/session/chat-session-store';
import { rememberSessionTranscript } from '@/features/chat/session/local-session-drafts';
import { cn } from '@/lib/cn';
import { fetchJson } from '@/lib/fetch';
import { SETTINGS_SHELL_CONTENT_Z, SETTINGS_SHELL_OVERLAY_Z } from '@/lib/settings-shell-dialog-layer';
import { apiUrl } from '@/lib/url';
import type { PersonalAgent } from './personal-page';

type ResetPayload = {
  conversationId: string;
  transcriptId: string;
  previousTranscriptId?: string;
  profile?: PersonalAgent | null;
};

type ApiResult<T> = { ok: boolean; payload: T };

export function PersonalConversationResetSetting({
  zh,
  displayName,
  profile,
}: {
  zh: boolean;
  displayName: string;
  profile?: { conversationId?: string; transcriptId?: string; state?: 'provisioning' | 'ready' | 'error' } | null;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  if (!profile?.conversationId || profile.state === 'provisioning' || profile.state === 'error') {
    return null;
  }

  async function confirmReset() {
    if (busy || !profile?.conversationId) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetchJson<ApiResult<ResetPayload>>(apiUrl('/api/personal-agent/conversation/reset'), {
        method: 'POST',
        body: JSON.stringify(profile.transcriptId ? { expectedTranscriptId: profile.transcriptId } : {}),
      });
      const payload = response.payload;
      await rememberSessionTranscript(payload.conversationId, payload.transcriptId).catch(() => {});
      const chatStore = useChatSessionStore.getState();
      chatStore.clearStreamingState(payload.conversationId);
      chatStore.setCommittedSnapshot(payload.conversationId, {
        messages: [],
        hasMore: false,
      });
      if (payload.profile) {
        window.dispatchEvent(new CustomEvent('personal-agent-updated', { detail: payload.profile }));
      }
      window.dispatchEvent(new CustomEvent('session-transcript-updated', { detail: { key: payload.conversationId } }));
      window.dispatchEvent(new Event('personal-unread-updated'));
      window.dispatchEvent(new Event('session-updated'));
      setDone(true);
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3 border-t border-edge pt-5" aria-label={zh ? '对话管理' : 'Conversation'}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <h3 className="text-sm font-medium text-fg">{zh ? '重新开始对话' : 'Start a fresh conversation'}</h3>
          <p className="text-xs text-fg-muted">
            {zh
              ? '归档当前对话记录并清空聊天窗口，以全新上下文开始。你的长期记忆、助手设置、定时任务和已委派任务都会保留。'
              : 'Archive the current transcript and clear the chat view to start with a fresh context. Your memory, settings, schedules, and delegated tasks are kept.'}
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          disabled={busy}
          onClick={() => {
            setError('');
            setOpen(true);
          }}
        >
          <RotateCcw className="size-4" aria-hidden />
          {zh ? '重新开始对话' : 'Start fresh'}
        </Button>
      </div>

      {done ? (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-edge bg-surface-panel px-3.5 py-2.5 text-xs text-fg-muted"
        >
          <span>{zh ? '已归档当前对话记录并开启新对话。' : 'Current transcript archived. A fresh conversation is ready.'}</span>
          <Link to="/personal" className="font-medium text-accent hover:underline">
            {zh ? `前往 ${displayName}` : `Open ${displayName}`}
          </Link>
        </div>
      ) : null}

      <Dialog.Root open={open} onOpenChange={(next) => { if (!busy) setOpen(next); }}>
        <Dialog.Portal>
          <Dialog.Overlay className={cn('fixed inset-0 bg-black/45', SETTINGS_SHELL_OVERLAY_Z)} />
          <Dialog.Content
            onKeyDown={(event) => event.stopPropagation()}
            className={cn(
              'xopc-dialog-content fixed left-1/2 top-1/2 flex h-[min(17.5rem,calc(100dvh-2rem))] w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-edge bg-surface-overlay shadow-popover outline-none',
              SETTINGS_SHELL_CONTENT_Z,
            )}
          >
            <header className="flex shrink-0 items-center justify-between border-b border-edge-subtle px-5 py-3">
              <Dialog.Title className="text-sm font-semibold text-fg">
                {zh ? '重新开始对话？' : 'Start a fresh conversation?'}
              </Dialog.Title>
              <Dialog.Close asChild>
                <Button
                  type="button"
                  variant="ghost"
                  className="size-9 p-0"
                  disabled={busy}
                  aria-label={zh ? '关闭' : 'Close'}
                >
                  <X className="size-4" />
                </Button>
              </Dialog.Close>
            </header>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
              <Dialog.Description className="text-sm leading-relaxed text-fg-muted">
                {zh
                  ? `当前与 ${displayName} 的聊天记录会被归档，对话窗口将清空并以全新上下文开始。`
                  : `Your current chat transcript with ${displayName} will be archived, and the chat window will clear with a fresh context.`}
              </Dialog.Description>
              <p className="text-xs leading-relaxed text-fg-muted">
                {zh
                  ? '长期记忆、模型与语音设定、定时任务，以及正在后台运行的委派任务都会保留，任务完成后仍会照常通知你。'
                  : 'Your memory, model and voice preferences, schedules, and running delegated tasks are kept. Completed tasks will still report back here.'}
              </p>
              {error ? <p role="alert" className="text-xs text-danger">{error}</p> : null}
            </div>
            <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-edge-subtle px-5 py-3">
              <Button type="button" variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
                {zh ? '取消' : 'Cancel'}
              </Button>
              <Button type="button" variant="primary" disabled={busy} onClick={() => void confirmReset()}>
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                {busy ? (zh ? '处理中…' : 'Resetting…') : (zh ? '归档并重新开始' : 'Archive & start fresh')}
              </Button>
            </footer>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}
