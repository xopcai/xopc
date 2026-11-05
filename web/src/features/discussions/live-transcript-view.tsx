import { useLayoutEffect, useRef, useState } from 'react';

/** Follow incoming speech until the reader scrolls back or selects text. */
export function LiveTranscriptView({ text, placeholder, zh }: { text: string; placeholder: string; zh: boolean }) {
  const viewport = useRef<HTMLDivElement>(null);
  const [following, setFollowing] = useState(true);
  const [snapshot, setSnapshot] = useState(text);
  const displayed = following ? text : snapshot;
  const pending = !following && text !== snapshot;
  useLayoutEffect(() => {
    if (following && viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight;
  }, [displayed, following]);
  function pause() { setSnapshot(displayed); setFollowing(false); }
  return <div className="mt-2">
    <div ref={viewport} tabIndex={0} aria-label={zh ? '实时文字' : 'Live transcript'}
      className="h-32 overflow-y-auto whitespace-pre-wrap text-sm leading-6 text-fg outline-none focus-visible:ring-2 focus-visible:ring-accent"
      onScroll={event => {
        const node = event.currentTarget;
        if (following && node.scrollHeight - node.scrollTop - node.clientHeight > 24) pause();
      }}
      onPointerDown={pause} onKeyDown={event => { if (event.key !== 'Tab') pause(); }}>
      {displayed || placeholder}
    </div>
    <div className="flex h-9 items-center justify-end text-xs text-fg-muted">
      {following ? <span>{zh ? '跟随最新文字' : 'Following live text'}</span> : <button type="button"
        className="min-h-9 rounded-lg px-2 text-accent-fg hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent"
        onClick={() => setFollowing(true)}>{pending ? (zh ? '有新文字 · 回到最新' : 'New text · Back to latest') : (zh ? '回到最新' : 'Back to latest')}</button>}
    </div>
  </div>;
}
