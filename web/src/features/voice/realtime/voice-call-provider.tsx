import * as Dialog from '@radix-ui/react-dialog';
import { AudioLines, Captions, Ellipsis, Mic, MicOff, Minimize2, Phone, PhoneOff } from 'lucide-react';
import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { MarkdownView } from '@/components/markdown/markdown-view';
import { TaskSessionBanner } from '@/features/chat/task/task-session-banner';
import { VoiceCallWork } from './voice-call-work';
import { VoiceDelegatedTasks } from './voice-delegated-tasks';
import { Button } from '@/components/ui/button';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';
import { useVoicePreferencesStore } from '@/stores/voice-preferences-store';

import { useRealtimeVoice } from './use-realtime-voice';
import { VoiceCallContext, type VoiceCallTarget } from './voice-call-context';

function clampMiniPosition(left: number, top: number, width: number, height: number) {
  return {
    left: Math.max(8, Math.min(left, window.innerWidth - width - 8)),
    top: Math.max(8, Math.min(top, window.innerHeight - height - 8)),
  };
}

export function VoiceCallProvider({ children }: { children: ReactNode }) {
  const language = useLocaleStore((state) => state.language);
  const m = messages(language).chat;
  const [target, setTarget] = useState<VoiceCallTarget | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [more, setMore] = useState(false);
  const captions = useVoicePreferencesStore((state) => state.captions);
  const setCaptions = useVoicePreferencesStore((state) => state.setCaptions);
  const voice = useRealtimeVoice({ disabled: false, chat: m, onTranscript: () => {} });
  const starting = useRef(false);
  const startAttempt = useRef(0);
  const miniCardRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; left: number; top: number; width: number; height: number; moved: boolean } | null>(null);
  const suppressMiniClick = useRef(false);
  const [miniPosition, setMiniPosition] = useState<{ left: number; top: number } | null>(null);
  useEffect(() => {
    const keepInView = () => {
      const card = miniCardRef.current;
      if (!card) return;
      setMiniPosition((position) => position ? clampMiniPosition(position.left, position.top, card.offsetWidth, card.offsetHeight) : null);
    };
    window.addEventListener('resize', keepInView);
    return () => window.removeEventListener('resize', keepInView);
  }, []);
  const startMiniDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    suppressMiniClick.current = false;
    const rect = miniCardRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, left: rect.left, top: rect.top, width: rect.width, height: rect.height, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveMiniDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    setMiniPosition(clampMiniPosition(drag.left + dx, drag.top + dy, drag.width, drag.height));
  };
  const endMiniDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    suppressMiniClick.current = dragRef.current.moved;
    dragRef.current = null;
  };
  const cancelMiniDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    suppressMiniClick.current = false;
  };
  const active = voice.voiceActive && voice.phase !== 'error';
  const connected = voice.phase === 'recording';
  const start = (next: VoiceCallTarget) => {
    if (starting.current || active) return;
    starting.current = true;
    const attempt = ++startAttempt.current;
    voice.cancelVoiceInput();
    setTarget(next);
    void voice.startVoiceConversation(next.conversationId, next.mode).finally(() => { if (attempt === startAttempt.current) starting.current = false; });
  };
  const context = {
    active,
    conversationId: active ? target?.conversationId ?? null : null,
    open: (next: VoiceCallTarget) => {
      start(next);
      setExpanded(false);
    },
  };
  const status = voice.error ? m.callFailed
    : !active ? voice.endedReason ? m.callDisconnected : m.callReady
      : !connected ? voice.callConnectionStage === 'preparing' ? m.callPreparing
        : voice.callConnectionStage === 'slow' ? m.callConnectingSlow : m.callConnecting
        : voice.clarification ? m.callWaiting
          : voice.activities.some((activity) => activity.status === 'running') ? m.callWorking
          : voice.responsePhase === 'speaking' ? m.voiceSpeaking
          : voice.responsePhase === 'thinking' ? target?.mode === 'assistant'
            ? language === 'zh' ? '正在组织回应…' : 'Getting back to you…'
            : m.voiceThinking
            : voice.muted ? m.callMicMuted : m.callListening;
  const end = () => {
    startAttempt.current += 1;
    starting.current = false;
    voice.cancelVoiceInput();
    setTarget(null);
    setExpanded(false);
    setMore(false);
    setMiniPosition(null);
  };
  const settingsPath = `/settings/capabilities/voice?returnTo=${encodeURIComponent(`/chat/${encodeURIComponent(target?.conversationId ?? '')}`)}`;
  const settingsLink = <Link to={settingsPath} onClick={() => setExpanded(false)} className="text-sm text-accent-fg hover:underline">{m.callSettings}</Link>;

  return <VoiceCallContext.Provider value={context}>
    {children}
    {target && !expanded ? <div ref={miniCardRef} style={miniPosition ? { left: miniPosition.left, top: miniPosition.top, right: 'auto' } : undefined} className="fixed right-5 top-[calc(5rem+env(safe-area-inset-top))] z-50 flex max-w-[calc(100vw-2.5rem)] items-center gap-3 rounded-xl border border-edge bg-surface-panel p-3 shadow-float" role="region" aria-label={m.voiceConversation}>
      <button type="button" aria-label={language === 'zh' ? '展开通话' : 'Expand call'} onClick={() => { if (suppressMiniClick.current) { suppressMiniClick.current = false; return; } setExpanded(true); }} onPointerDown={startMiniDrag} onPointerMove={moveMiniDrag} onPointerUp={endMiniDrag} onPointerCancel={cancelMiniDrag} className="min-w-0 touch-none select-none rounded-lg text-left cursor-grab active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
        <span className="block truncate text-sm font-medium text-fg">{target.name}</span>
        <span className="block text-xs text-fg-muted">{status}{connected ? ` · ${voice.elapsedLabel}` : ''}</span>
      </button>
      <Button variant="ghost" disabled={!connected} onClick={voice.toggleMute} aria-label={voice.muted ? m.callUnmute : m.callMute}>{voice.muted ? <MicOff className="size-4" /> : <Mic className="size-4" />}</Button>
      <Button variant="ghost" onClick={end} aria-label={m.callEnd}><PhoneOff className="size-4 text-red-500" /></Button>
    </div> : null}
    <Dialog.Root open={Boolean(target && expanded)} onOpenChange={(open) => { if (!open) setExpanded(false); }} modal={false}>
      <Dialog.Portal>
        <Dialog.Content onInteractOutside={(event) => event.preventDefault()} className="xopc-dialog-content-pane fixed right-3 top-[calc(4.5rem+env(safe-area-inset-top))] z-[71] flex h-[min(480px,calc(100dvh-6rem))] w-[min(380px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-xl border border-edge bg-surface-overlay text-fg shadow-float focus:outline-none">
          <header className="flex shrink-0 items-center justify-between gap-3 border-b border-edge px-4 py-3">
            <div className="min-w-0"><Dialog.Title className="truncate font-medium">{target?.name}</Dialog.Title><Dialog.Description className="text-xs text-fg-muted">{m.callSessionHint}</Dialog.Description></div>
            <div className="flex"><Button variant="ghost" onClick={() => setMore(!more)} aria-label={m.callMore} aria-expanded={more}><Ellipsis className="size-4" /></Button><Button variant="ghost" onClick={() => setExpanded(false)} aria-label={m.callMinimize}><Minimize2 className="size-4" /></Button></div>
          </header>
          {more ? <div className="flex shrink-0 items-center justify-between border-b border-edge px-4 py-2"><Button variant="ghost" aria-pressed={captions} onClick={() => setCaptions(!captions)}><Captions className="size-4" />{m.callCaptions}</Button>{settingsLink}</div> : null}
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-5 py-5">
            <AudioLines className="size-10 text-accent-fg" aria-hidden="true" />
            <div><p className="text-lg font-medium" role="status">{status}</p>{connected || !active ? <p className="mt-1 text-xs tabular-nums text-fg-muted">{connected ? voice.elapsedLabel : m.callContinuity}{connected && voice.muted && voice.responsePhase !== 'idle' ? ` · ${m.callMicMuted}` : ''}</p> : null}</div>
            {voice.error ? <details className="text-sm text-fg-muted"><summary className="cursor-pointer">{m.callErrorDetails}</summary><p role="alert" className="mt-2 break-words text-xs">{voice.error}</p></details> : null}
            {!active && voice.failureKind === 'session' ? <div className="space-y-2 text-sm text-fg-muted"><p>{m.callSetupHint}</p>{settingsLink}</div> : null}
            {connected && captions ? <div className="space-y-3 text-sm leading-relaxed">
              {(voice.partialTranscript || voice.finalTranscript) ? <p><span className="mb-1 block text-xs text-fg-subtle">{m.callYou}</span>{voice.partialTranscript || voice.finalTranscript}</p> : null}
              {voice.responseText ? <div><span className="mb-1 block text-xs text-fg-subtle">{target?.name}</span><MarkdownView content={voice.responseText} compact codeCopy={false} renderMermaid={false} /></div> : null}
            </div> : null}
            {target?.taskId ? <TaskSessionBanner taskId={target.taskId} /> : null}
            {connected && target ? <VoiceDelegatedTasks conversationId={target.conversationId} /> : null}
            {connected && target ? <VoiceCallWork key={target.conversationId} voice={voice} conversationId={target.conversationId} m={m} /> : null}
          </div>
          <footer className="flex shrink-0 flex-wrap items-center justify-center gap-2 border-t border-edge px-3 pb-[max(.75rem,env(safe-area-inset-bottom))] pt-3">
            {active ? <>
              <Button variant="secondary" disabled={!connected} onClick={voice.toggleMute} aria-pressed={voice.muted}>{voice.muted ? <MicOff className="size-4" /> : <Mic className="size-4" />}{voice.muted ? m.callUnmute : m.callMute}</Button>
              {voice.responsePhase !== 'idle' ? <Button variant="ghost" onClick={voice.interruptResponse}>{m.voiceResponseInterrupt}</Button> : null}
            </> : <Button variant="primary" onClick={() => { if (target) start(target); }}><Phone className="size-4" />{m.callReconnect}</Button>}
            <Button variant="secondary" onClick={end}><PhoneOff className="size-4 text-red-500" />{m.callEnd}</Button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  </VoiceCallContext.Provider>;
}
