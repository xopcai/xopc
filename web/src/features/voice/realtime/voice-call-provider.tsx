import * as Dialog from '@radix-ui/react-dialog';
import { AudioLines, Captions, Ellipsis, Mic, MicOff, Minimize2, Phone, PhoneOff } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { MarkdownView } from '@/components/markdown/markdown-view';
import { TaskSessionBanner } from '@/features/chat/task/task-session-banner';
import { VoiceCallWork } from './voice-call-work';
import { Button } from '@/components/ui/button';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';
import { useVoicePreferencesStore } from '@/stores/voice-preferences-store';

import { useRealtimeVoice } from './use-realtime-voice';
import { VoiceCallContext, type VoiceCallTarget } from './voice-call-context';

export function VoiceCallProvider({ children }: { children: ReactNode }) {
  const m = messages(useLocaleStore((state) => state.language)).chat;
  const [target, setTarget] = useState<VoiceCallTarget | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [more, setMore] = useState(false);
  const captions = useVoicePreferencesStore((state) => state.captions);
  const setCaptions = useVoicePreferencesStore((state) => state.setCaptions);
  const voice = useRealtimeVoice({ disabled: false, chat: m, onTranscript: () => {} });
  const starting = useRef(false);
  const startAttempt = useRef(0);
  const active = voice.voiceActive && voice.phase !== 'error';
  const connected = voice.phase === 'recording';
  const start = (next: VoiceCallTarget) => {
    if (starting.current || active) return;
    starting.current = true;
    const attempt = ++startAttempt.current;
    voice.cancelVoiceInput();
    setTarget(next);
    void voice.startVoiceConversation(next.sessionKey).finally(() => { if (attempt === startAttempt.current) starting.current = false; });
  };
  const context = {
    active,
    sessionKey: active ? target?.sessionKey ?? null : null,
    open: (next: VoiceCallTarget) => {
      start(next);
      setExpanded(true);
    },
  };
  const status = voice.error ? m.callFailed
    : !active ? voice.endedReason ? m.callDisconnected : m.callReady
      : !connected ? m.callConnecting
        : voice.clarification ? m.callWaiting
          : voice.activities.some((activity) => activity.status === 'running') ? m.callWorking
          : voice.responsePhase === 'speaking' ? m.voiceSpeaking
          : voice.responsePhase === 'thinking' ? m.voiceThinking
            : voice.muted ? m.callMicMuted : m.callListening;
  const end = () => {
    startAttempt.current += 1;
    starting.current = false;
    voice.cancelVoiceInput();
    setTarget(null);
    setExpanded(false);
    setMore(false);
  };
  const settingsPath = `/settings/capabilities/voice?returnTo=${encodeURIComponent(`/chat/${encodeURIComponent(target?.sessionKey ?? '')}`)}`;
  const settingsLink = <Link to={settingsPath} onClick={() => setExpanded(false)} className="text-sm text-accent-fg hover:underline">{m.callSettings}</Link>;

  return <VoiceCallContext.Provider value={context}>
    {children}
    {target && !expanded ? <div className="fixed bottom-5 right-5 z-50 flex max-w-[calc(100vw-2.5rem)] items-center gap-3 rounded-xl border border-edge bg-surface-panel p-3 shadow-float" role="region" aria-label={m.voiceConversation}>
      <button type="button" onClick={() => setExpanded(true)} className="min-w-0 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
        <span className="block truncate text-sm font-medium text-fg">{target.name}</span>
        <span className="block text-xs text-fg-muted">{status} · {voice.elapsedLabel}</span>
      </button>
      <Button variant="ghost" disabled={!connected} onClick={voice.toggleMute} aria-label={voice.muted ? m.callUnmute : m.callMute}>{voice.muted ? <MicOff className="size-4" /> : <Mic className="size-4" />}</Button>
      <Button variant="ghost" onClick={end} aria-label={m.callEnd}><PhoneOff className="size-4 text-red-500" /></Button>
    </div> : null}
    <Dialog.Root open={Boolean(target && expanded)} onOpenChange={(open) => { if (!open) setExpanded(false); }} modal={false}>
      <Dialog.Portal>
        <Dialog.Content onInteractOutside={(event) => event.preventDefault()} className="fixed bottom-3 right-3 z-[71] flex h-[min(480px,85dvh)] w-[min(380px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-xl border border-edge bg-surface-panel text-fg shadow-float focus:outline-none">
          <header className="flex shrink-0 items-center justify-between gap-3 border-b border-edge px-4 py-3">
            <div className="min-w-0"><Dialog.Title className="truncate font-medium">{target?.name}</Dialog.Title><Dialog.Description className="text-xs text-fg-muted">{m.callSessionHint}</Dialog.Description></div>
            <div className="flex"><Button variant="ghost" onClick={() => setMore(!more)} aria-label={m.callMore} aria-expanded={more}><Ellipsis className="size-4" /></Button><Button variant="ghost" onClick={() => setExpanded(false)} aria-label={m.callMinimize}><Minimize2 className="size-4" /></Button></div>
          </header>
          {more ? <div className="flex shrink-0 items-center justify-between border-b border-edge px-4 py-2"><Button variant="ghost" aria-pressed={captions} onClick={() => setCaptions(!captions)}><Captions className="size-4" />{m.callCaptions}</Button>{settingsLink}</div> : null}
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-5 py-5">
            <AudioLines className="size-10 text-accent-fg" aria-hidden="true" />
            <div><p className="text-lg font-medium" role="status">{status}</p><p className="mt-1 text-xs tabular-nums text-fg-muted">{active ? voice.elapsedLabel : m.callContinuity}{connected && voice.muted && voice.responsePhase !== 'idle' ? ` · ${m.callMicMuted}` : ''}</p></div>
            {voice.error ? <details className="text-sm text-fg-muted"><summary className="cursor-pointer">{m.callErrorDetails}</summary><p role="alert" className="mt-2 break-words text-xs">{voice.error}</p></details> : null}
            {!active && voice.failureKind === 'session' ? <div className="space-y-2 text-sm text-fg-muted"><p>{m.callSetupHint}</p>{settingsLink}</div> : null}
            {connected && captions ? <div className="space-y-3 text-sm leading-relaxed">
              {(voice.partialTranscript || voice.finalTranscript) ? <p><span className="mb-1 block text-xs text-fg-subtle">{m.callYou}</span>{voice.partialTranscript || voice.finalTranscript}</p> : null}
              {voice.responseText ? <div><span className="mb-1 block text-xs text-fg-subtle">{target?.name}</span><MarkdownView content={voice.responseText} compact codeCopy={false} renderMermaid={false} /></div> : null}
            </div> : null}
            {target?.taskId ? <TaskSessionBanner taskId={target.taskId} /> : null}
            {connected && target ? <VoiceCallWork key={target.sessionKey} voice={voice} sessionKey={target.sessionKey} m={m} /> : null}
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
