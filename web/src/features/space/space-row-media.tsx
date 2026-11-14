import { File, FileImage, Film, Pause, Play, RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { playGeneratedMedia, useGeneratedMediaStore } from '@/features/media-playback/generated-media';
import { useGeneratedMediaControls } from '@/features/media-playback/use-generated-media';
import { cn } from '@/lib/cn';

const thumbnailClass = 'grid h-9 w-11 shrink-0 place-items-center overflow-hidden rounded-md bg-surface-inset text-fg-muted';

export function SpaceThumbnail({ kind, src }: { kind: 'image' | 'video'; src: string }) {
  const thumbnail = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const node = thumbnail.current;
    if (kind !== 'video' || !node) return;
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      setVisible(true);
      observer.disconnect();
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [kind]);

  const Icon = kind === 'image' ? FileImage : Film;
  const mediaClass = cn('absolute inset-0 size-full object-cover', !ready && 'invisible');
  return (
    <span ref={thumbnail} className={cn(thumbnailClass, 'relative')} aria-hidden>
      <Icon className="size-4" />
      {!failed && (kind === 'image'
        ? <img src={src} width={44} height={36} loading="lazy" decoding="async" alt="" className={mediaClass}
          onLoad={() => setReady(true)} onError={() => setFailed(true)} />
        : visible && <video src={`${src}#t=0.1`} muted playsInline preload="metadata" className={mediaClass}
          onLoadedData={() => setReady(true)} onError={() => setFailed(true)} />)}
    </span>
  );
}

export function SpaceFileIcon({ icon: Icon = File }: { icon?: typeof File }) {
  return <span className={thumbnailClass}><Icon className="size-4" aria-hidden /></span>;
}

export function SpaceAudioButton({ src, title, zh }: { src: string; title: string; zh: boolean }) {
  const element = useGeneratedMediaStore(state => state.active?.entry.source.src === src ? state.active.entry.element : null);
  const { playing, starting, failed: mediaFailed, toggle } = useGeneratedMediaControls(element);
  const [failed, setFailed] = useState(false);
  const retry = failed || mediaFailed;
  const pause = playing || starting;
  const Icon = retry ? RotateCcw : pause ? Pause : Play;
  const action = retry ? (zh ? '重试播放' : 'Retry playback') : pause ? (zh ? '暂停' : 'Pause') : (zh ? '播放' : 'Play');

  function onClick() {
    setFailed(false);
    if (element) toggle();
    else void playGeneratedMedia({ kind: 'audio', src, title }).catch((error: unknown) => {
      if (!(error instanceof DOMException && error.name === 'AbortError')) setFailed(true);
    });
  }

  return <>
    <button type="button" aria-label={`${action} ${title}`} title={action} onClick={onClick}
      className="absolute start-2 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-md focus-visible:outline-2 focus-visible:outline-accent sm:start-3">
      <span className={cn(thumbnailClass, 'hover:bg-surface-active', pause && 'bg-accent-soft text-accent-fg')}>
        <Icon className="size-4" aria-hidden />
      </span>
    </button>
    {failed ? <span role="alert" className="sr-only">{zh ? '音频暂时无法播放，请重试。' : 'Audio could not play. Try again.'}</span> : null}
  </>;
}
