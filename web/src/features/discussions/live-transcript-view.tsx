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
  return <div className="relative">
    <div ref={viewport} tabIndex={0} aria-label={zh ? '实时文字' : 'Live transcript'}
      className="h-20 overflow-y-auto whitespace-pre-wrap text-xs leading-5 text-fg outline-none focus-visible:ring-2 focus-visible:ring-accent"
      onScroll={event => {
        const node = event.currentTarget;
        if (following && node.scrollHeight - node.scrollTop - node.clientHeight > 24) pause();
      }}
      onPointerDown={pause} onKeyDown={event => { if (event.key !== 'Tab') pause(); }}>
      {displayed ? displayed : <span className="text-fg-muted">{placeholder}</span>}
    </div>
    {!following ? (
      <div className="mt-1 flex justify-end">
        <button
          type="button"
          className="inline-flex h-6 items-center rounded-full border border-edge bg-surface-panel px-2.5 text-[11px] font-medium text-accent-fg shadow-xs hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent"
          onClick={() => setFollowing(true)}
        >
          {pending ? (zh ? '有新文字 · 回到最新' : 'New text · Latest') : (zh ? '回到最新' : 'Latest')}
        </button>
      </div>
    ) : null}
  </div>;
}
