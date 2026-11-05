import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

import type { EditorTextSelection } from '@/components/editor-text-selection';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { copyTextToClipboard } from '@/lib/copy-to-clipboard';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

type Preview = { patch: { operations: Array<{ type: string; markdown?: string }> } };

/** Local edit previews use the existing notes endpoint; insertion is an explicit editor transaction. */
export function NoteSelectionActions({ noteId, selection, zh, onDismiss, onAsk }: {
  noteId: string; selection: EditorTextSelection; zh: boolean; onDismiss: () => void; onAsk: (text: string) => void;
}) {
  const [result, setResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const request = useRef<AbortController | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 8, top: 8 });
  const expanded = loading || result !== null || !!error;
  const tooLong = selection.text.length > 16_000;
  function dismiss() { request.current?.abort(); onDismiss(); selection.restore(); }
  useEffect(() => {
    setResult(null); setLoading(false); setError(''); setCopied(false);
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) onDismiss(); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); onDismiss(); selection.restore(); } };
    const scroll = (event: Event) => { if (!root.current?.contains(event.target as Node) && !request.current && !root.current?.contains(document.activeElement)) onDismiss(); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    window.addEventListener('resize', onDismiss);
    window.addEventListener('scroll', scroll, true);
    return () => {
      request.current?.abort(); request.current = null;
      document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape);
      window.removeEventListener('resize', onDismiss); window.removeEventListener('scroll', scroll, true);
    };
  }, [selection, onDismiss]);
  useLayoutEffect(() => {
    const rect = root.current?.getBoundingClientRect(); if (!rect) return;
    const left = Math.max(8, Math.min(selection.rect.left, window.innerWidth - rect.width - 8));
    const preferred = selection.rect.bottom + 8;
    const top = preferred + rect.height <= window.innerHeight - 8 ? preferred : Math.max(8, selection.rect.top - rect.height - 8);
    setPosition({ left, top });
  }, [selection, expanded, result, error]);
  async function preview(instruction: string) {
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setLoading(true); setError(''); setResult(null); setCopied(false);
    try {
      const value = await fetchJson<Preview>(apiUrl(`/api/notes/${encodeURIComponent(noteId)}/ai/edit`), {
        method: 'POST', signal: controller.signal, body: JSON.stringify({ instruction, markdown: selection.text }),
      });
      if (controller.signal.aborted) return;
      const markdown = value.patch.operations.filter(operation => operation.type === 'replaceRange').map(operation => operation.markdown ?? '').join('\n\n');
      if (!markdown.trim()) throw new Error(zh ? '没有可用结果，请重试。' : 'No result available. Try again.');
      setResult(markdown);
    } catch (caught) { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { if (!controller.signal.aborted) { setLoading(false); request.current = null; } }
  }
  return createPortal(<div ref={root} role="region" data-note-selection-actions aria-keyshortcuts="Alt+Enter" aria-label={zh ? '笔记选段操作' : 'Note selection actions'}
    className={`fixed z-[80] flex max-h-[calc(100dvh-1rem)] max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-xl border border-edge bg-surface-overlay text-fg shadow-popover ${expanded ? 'w-96' : ''}`}
    style={position} onPointerDown={event => { if ((event.target as Element).closest('button')) event.preventDefault(); }}>
    <div role="group" aria-label={zh ? '选段操作' : 'Selection actions'} className="flex shrink-0 flex-wrap items-center gap-1 p-1">
      <Button variant="ghost" className="text-xs" disabled={loading || tooLong} onClick={() => void preview('summary')}>{zh ? '摘要预览' : 'Summary'}</Button>
      <Button variant="ghost" className="text-xs" disabled={loading || tooLong} onClick={() => void preview('todo')}>{zh ? '提取待办' : 'Extract to-dos'}</Button>
      <Button variant="ghost" className="text-xs" disabled={loading || tooLong} onClick={() => onAsk(selection.text)}>{zh ? '引用提问' : 'Ask about selection'}</Button>
      <button type="button" className="inline-flex size-9 items-center justify-center rounded-lg hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent" aria-label={zh ? '关闭选段操作' : 'Close selection actions'} onClick={dismiss}><X className="size-4" /></button>
    </div>
    {tooLong ? <p className="px-3 pb-3 text-xs text-fg-muted">{zh ? '请选择不超过 16000 字的片段。' : 'Select up to 16,000 characters.'}</p> : null}
    {expanded ? <>
      <div className="min-h-0 flex-1 overflow-y-auto border-t border-edge-subtle p-3">
        <p className="mb-3 text-xs text-fg-muted">{zh ? '按选段生成的本地整理预览，尚未写入笔记。' : 'Local preview of the selection. Your note is unchanged.'}</p>
        {loading ? <div aria-busy="true" className="space-y-2"><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-2/3" /></div> : null}
        {result !== null ? <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-6">{result}</pre> : null}
        {error ? <p role="alert" className="text-xs text-danger">{error}</p> : null}
      </div>
      {result !== null ? <div className="flex shrink-0 justify-end gap-2 border-t border-edge-subtle p-2">
        <Button variant="ghost" onClick={() => void copyTextToClipboard(result).then(ok => { setCopied(ok); if (!ok) setError(zh ? '复制失败，请重试。' : 'Copy failed. Try again.'); })}>{copied ? (zh ? '已复制' : 'Copied') : (zh ? '复制结果' : 'Copy')}</Button>
        <Button variant="primary" onClick={() => {
          if (selection.insertAfter(result)) onDismiss();
          else setError(zh ? '正文已变化，请重新选择片段后再整理。' : 'The note changed. Select the passage again.');
        }}>{zh ? '插入选段后' : 'Insert after selection'}</Button>
      </div> : null}
    </> : null}
  </div>, document.body);
}
