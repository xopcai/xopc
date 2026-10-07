import { Play } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { fetchRealtimeVoiceStatus, fetchTtsVoices, previewRealtimeVoice } from '@/features/settings/voice-config-api';
import { PcmPlayer } from '@/features/voice/realtime/pcm-player';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

import type { PersonalAgent } from './personal-page';

type Voice = { id: string; name: string; description?: string; style?: string };

export function PersonalVoiceSetting({ record, zh, onSaved }: {
  record: PersonalAgent;
  zh: boolean;
  onSaved: (record: PersonalAgent) => void;
}) {
  const [route, setRoute] = useState<{ provider: string; model: string } | null>(null);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [selected, setSelected] = useState(record.voicePreference?.voice ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const player = useRef<PcmPlayer | null>(null);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchRealtimeVoiceStatus().then(status => {
      if (!cancelled && status.enabled && status.tts) setRoute({ provider: status.tts.provider, model: status.tts.model });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!route) return;
    let cancelled = false;
    void fetchTtsVoices(route.provider, route.model, 'realtime')
      .then(items => { if (!cancelled) setVoices(items); })
      .catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { cancelled = true; };
  }, [route]);

  useEffect(() => () => { controller.current?.abort(); void player.current?.close(); }, []);

  const preview = async (voice: string) => {
    controller.current?.abort();
    void player.current?.close();
    const next = new AbortController();
    controller.current = next;
    setPlaying(voice);
    try {
      const nextPlayer = new PcmPlayer();
      player.current = nextPlayer;
      await nextPlayer.start();
      const audio = await previewRealtimeVoice(next.signal, voice);
      if (!next.signal.aborted) nextPlayer.enqueue(audio, () => setPlaying(null));
    } catch (cause) {
      if (!next.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
      setPlaying(null);
    }
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const voicePreference = selected && route
        ? { provider: route.provider, model: route.model, voice: selected } : null;
      const result = await fetchJson<{ payload: PersonalAgent }>(apiUrl('/api/personal-agent/profile'), {
        method: 'PATCH',
        body: JSON.stringify({ revision: record.revision, displayName: record.displayName,
          appearance: record.appearance, preferences: record.preferences, voicePreference }),
      });
      onSaved(result.payload);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };

  return <section className="mt-12">
    <h3 className="text-sm font-medium text-fg">{zh ? '语音声音' : 'Speaking voice'}</h3>
    <p className="mt-1 text-xs text-fg-muted">{zh ? '只用于这个助手的语音通话。' : 'Used only for calls with this assistant.'}</p>
    {route && voices.length ? <div className="mt-3 grid gap-2 sm:grid-cols-2">
      <button type="button" onClick={() => setSelected('')} aria-pressed={!selected} className={`rounded-xl px-3 py-3 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${!selected ? 'bg-accent/10 text-fg ring-1 ring-accent/40' : 'bg-surface-panel text-fg-muted hover:bg-surface-hover'}`}>{zh ? '默认声音' : 'Default voice'}</button>
      {voices.map(voice => <div key={voice.id} className={`flex items-center rounded-xl px-3 py-2 transition-colors ${selected === voice.id ? 'bg-accent/10 ring-1 ring-accent/40' : 'bg-surface-panel hover:bg-surface-hover'}`}><button type="button" aria-pressed={selected === voice.id} onClick={() => setSelected(voice.id)} className="min-w-0 flex-1 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"><span className="block text-sm text-fg">{voice.name}</span><span className="block truncate text-xs text-fg-muted">{voice.description || voice.style}</span></button><button type="button" onClick={() => void preview(voice.id)} className="flex size-9 items-center justify-center rounded-full hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" aria-label={zh ? `试听${voice.name}` : `Preview ${voice.name}`}><Play className={`size-4 ${playing === voice.id ? 'text-accent' : 'text-fg-muted'}`} /></button></div>)}
    </div> : <p className="mt-3 text-sm text-fg-muted">{zh ? '当前没有可用音色。' : 'No voice is ready.'} <Link to="/settings/capabilities/voice?returnTo=%2Fpersonal" className="text-accent underline">{zh ? '设置语音服务' : 'Set up voice'}</Link></p>}
    {error && <p role="alert" className="mt-3 text-xs text-danger">{error}</p>}
    {route && voices.length > 0 && <button type="button" disabled={busy} onClick={() => void save()} className="mt-3 rounded-lg bg-surface-panel px-4 py-2 text-xs font-medium text-fg transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40">{busy ? (zh ? '保存中…' : 'Saving…') : (zh ? '保存声音' : 'Save voice')}</button>}
  </section>;
}
