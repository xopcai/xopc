import { Play, Square } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { PopoverSelect } from '@/components/ui/popover-select';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchRealtimeVoiceStatus, fetchTtsVoices, previewRealtimeVoice } from '@/features/settings/voice-config-api';
import { PcmPlayer } from '@/features/voice/realtime/pcm-player';

import type { PersonalAgent } from './personal-page';

type Voice = { id: string; name: string; description?: string; style?: string };

export function PersonalVoiceSetting({ record, zh, onSelectVoice, onGreetingChange, onOpenServices, active = true }: {
  record: PersonalAgent;
  zh: boolean;
  onGreetingChange?: (enabled: boolean) => Promise<boolean>;
  onOpenServices?: () => void;
  onSelectVoice: (voicePreference: PersonalAgent['voicePreference']) => Promise<boolean>;
  active?: boolean;
}) {
  const [greetingSupported, setGreetingSupported] = useState(false);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [route, setRoute] = useState<{ provider: string; model: string } | null>(null);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [selected, setSelected] = useState(record.voicePreference?.voice ?? '');
  const [busy, setBusy] = useState(false);
  const [pendingGreeting, setPendingGreeting] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const player = useRef<PcmPlayer | null>(null);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const status = await fetchRealtimeVoiceStatus();
        if (cancelled) return;
        setGreetingSupported(status.openingGreeting === true);
        if (!status.enabled || !status.tts) return;
        const nextRoute = { provider: status.tts.provider, model: status.tts.model };
        setRoute(nextRoute);
        const items = await fetchTtsVoices(nextRoute.provider, nextRoute.model, 'realtime');
        if (!cancelled) setVoices(items);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => () => { controller.current?.abort(); void player.current?.close(); }, []);

  const stopPreview = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    void player.current?.close();
    player.current = null;
    setPlaying(null);
  }, []);

  useEffect(() => { if (!active) stopPreview(); }, [active, stopPreview]);

  const preview = async (voice: string) => {
    if (playing !== null) { stopPreview(); return; }
    stopPreview();
    setError(null);
    const next = new AbortController();
    controller.current = next;
    setPlaying(voice);
    try {
      const nextPlayer = new PcmPlayer();
      player.current = nextPlayer;
      await nextPlayer.start();
      const audio = await previewRealtimeVoice(next.signal, voice);
      if (!next.signal.aborted) nextPlayer.enqueue(audio, () => {
        if (controller.current !== next) return;
        setPlaying(null);
        controller.current = null;
        player.current = null;
        void nextPlayer.close();
      });
    } catch (cause) {
      if (!next.signal.aborted) {
        const code = (cause as { body?: { error?: { code?: string } } } | null)?.body?.error?.code;
        setError(zh && code === 'unsupported_voice'
          ? '当前音色暂不可用，请刷新语音目录或选择其他音色。'
          : cause instanceof Error ? cause.message : String(cause));
      }
      if (controller.current === next) stopPreview();
    }
  };

  const selectVoice = async (voice: string) => {
    if (busy || voice === selected) return;
    stopPreview();
    const previous = selected;
    setSelected(voice);
    setQuery('');
    setBusy(true);
    setError(null);
    try {
      const voicePreference = voice && route
        ? { provider: route.provider, model: route.model, voice } : null;
      if (!await onSelectVoice(voicePreference)) setSelected(previous);
    } catch (cause) { setSelected(previous); setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };

  const selectedVoice = voices.find(voice => voice.id === selected);
  const defaultLabel = zh ? '默认声音' : 'Default voice';
  const selectedLabel = selectedVoice?.name || (selected ? (zh ? '当前音色不可用' : 'Current voice unavailable') : defaultLabel);
  const search = query.trim().toLocaleLowerCase();
  const options = voices.filter(voice => !search || `${voice.name} ${voice.description ?? ''} ${voice.style ?? ''}`.toLocaleLowerCase().includes(search))
    .map(voice => ({ value: voice.id, label: voice.name }));

  return <section>
    <h4 className="text-sm text-fg">{zh ? '声音' : 'Voice'}</h4>
    {loading ? <div className="mt-1" aria-busy="true"><Skeleton className="h-10 w-full" /></div>
      : route && voices.length ? <div className="mt-1 space-y-2">
        <div className="flex min-w-0 items-center gap-2">
          <div className="min-w-0 flex-1">
            <PopoverSelect value={selected} selectedLabel={selectedLabel} options={options}
              side="top"
              placeholder={defaultLabel} emptyLabel={defaultLabel} ariaLabel={zh ? '选择通话音色' : 'Choose call voice'}
              disabled={busy} onChange={voice => void selectVoice(voice)}
              searchPlaceholder={voices.length > 8 ? (zh ? '搜索音色' : 'Search voices') : undefined}
              searchValue={query} onSearchChange={setQuery}
              statusMessage={search && !options.length ? (zh ? '没有匹配的音色' : 'No matching voices') : undefined} />
          </div>
          <button type="button" disabled={busy || Boolean(selected && !selectedVoice)} onClick={() => void preview(selected)}
            className="touch-target flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-edge px-3 text-sm text-fg-muted hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
            title={playing !== null ? (zh ? '停止试听' : 'Stop preview') : (zh ? `试听${selectedLabel}` : `Preview ${selectedLabel}`)}
            aria-label={playing !== null ? (zh ? '停止试听' : 'Stop preview') : (zh ? `试听${selectedLabel}` : `Preview ${selectedLabel}`)}>
            {playing !== null ? <Square className="size-4 text-accent" aria-hidden /> : <Play className="size-4" aria-hidden />}
            {playing !== null ? (zh ? '停止' : 'Stop') : (zh ? '试听' : 'Preview')}
          </button>
        </div>
        {(selectedVoice?.description || selectedVoice?.style || !selected) && <p className="text-xs leading-relaxed text-fg-muted">{selectedVoice?.description || selectedVoice?.style || (zh ? '跟随语音服务的默认音色。' : 'Uses the voice service’s default voice.')}</p>}
      </div> : <p className="mt-1 text-sm text-fg-muted">{zh ? '当前没有可用音色。' : 'No voice is ready.'}{' '}
        {onOpenServices ? <button type="button" onClick={onOpenServices} className="text-accent underline">{zh ? '设置语音服务' : 'Set up voice'}</button>
          : <Link to="/settings/personal" className="text-accent underline">{zh ? '设置语音服务' : 'Set up voice'}</Link>}</p>}
    {onGreetingChange && greetingSupported && <label className="mt-4 flex items-center justify-between gap-3 text-sm text-fg">
      {zh ? '接通时问候' : 'Greet me when connected'}
      <input type="checkbox" checked={pendingGreeting ?? record.voiceCallPreferences?.openingGreetingEnabled ?? true} disabled={busy || pendingGreeting !== null}
        onChange={event => { const enabled = event.target.checked; setPendingGreeting(enabled);
          void onGreetingChange(enabled).catch(cause => setError(String(cause))).finally(() => setPendingGreeting(null)); }} />
    </label>}
    {error && <p role="alert" className="mt-3 text-xs text-danger">{error}</p>}
  </section>;
}
