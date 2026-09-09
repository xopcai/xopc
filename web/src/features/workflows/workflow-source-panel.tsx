import { Check, Clipboard, Download, FileJson, Upload } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';

import { JsonEditor } from '@/components/codemirror/json-editor';
import { Button } from '@/components/ui/button';
import { copyTextToClipboard } from '@/lib/copy-to-clipboard';
import type { StoredLanguage } from '@/lib/storage';
import { useThemeStore } from '@/stores/theme-store';

export function WorkflowSourcePanel({
  initialSource,
  resetKey,
  fileName,
  language,
  readOnly = true,
  error,
  onChange,
  allowImport = false,
  className = 'h-[28rem]',
}: {
  initialSource: string;
  resetKey: string | number;
  fileName: string;
  language: StoredLanguage;
  readOnly?: boolean;
  error?: string | null;
  onChange?: (source: string) => void;
  allowImport?: boolean;
  className?: string;
}) {
  const copy = sourcePanelCopy(language);
  const isDark = useThemeStore((state) => state.resolved) === 'dark';
  const [source, setSource] = useState(initialSource);
  const [editorRevision, setEditorRevision] = useState(0);
  const [copied, setCopied] = useState(false);
  const [resizedHeight, setResizedHeight] = useState<number | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const resizeRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const initialSourceRef = useRef(initialSource);
  initialSourceRef.current = initialSource;

  useEffect(() => {
    setSource(initialSourceRef.current);
    setEditorRevision((value) => value + 1);
  }, [resetKey]);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const resize = resizeRef.current;
      if (!resize) return;
      setResizedHeight(clampSourceHeight(resize.startHeight + event.clientY - resize.startY));
    };
    const stop = () => {
      resizeRef.current = null;
      document.body.style.removeProperty('cursor');
      document.body.style.removeProperty('user-select');
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      stop();
    };
  }, []);

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!panelRef.current) return;
    event.preventDefault();
    resizeRef.current = { startY: event.clientY, startHeight: panelRef.current.getBoundingClientRect().height };
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  };

  const resizeWithKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const currentHeight = resizedHeight ?? panelRef.current?.getBoundingClientRect().height ?? 448;
    setResizedHeight(clampSourceHeight(currentHeight + (event.key === 'ArrowDown' ? 24 : -24)));
  };

  const updateSource = (next: string) => {
    setSource(next);
    onChange?.(next);
  };

  const format = () => {
    try {
      const formatted = `${JSON.stringify(JSON.parse(source), null, 2)}\n`;
      updateSource(formatted);
      setEditorRevision((value) => value + 1);
    } catch {
      // The visible parse error already explains why formatting is unavailable.
    }
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([source], { type: 'application/json;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section
      ref={panelRef}
      className={`relative flex min-h-0 flex-col overflow-hidden rounded-xl border border-edge bg-surface-base ${className}`}
      style={resizedHeight === null ? undefined : { height: resizedHeight, minHeight: 280, flex: 'none' }}
    >
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-edge bg-surface-panel px-3 py-2">
        <div className="mr-auto flex items-center gap-2 text-xs text-fg-muted">
          <FileJson className="size-3.5" aria-hidden />
          <span>{copy.title}</span>
          <span className={error ? 'text-danger' : 'text-success'}>{error ? copy.invalid : copy.valid}</span>
        </div>
        {!readOnly ? <Button type="button" variant="ghost" className="h-8 px-2 text-xs" disabled={Boolean(error)} onClick={format}>{copy.format}</Button> : null}
        {allowImport ? (
          <>
            <input
              ref={inputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void file.text().then((next) => {
                  updateSource(next);
                  setEditorRevision((value) => value + 1);
                });
              }}
            />
            <Button type="button" variant="ghost" className="h-8 px-2 text-xs" onClick={() => inputRef.current?.click()}>
              <Upload className="size-3.5" aria-hidden />{copy.import}
            </Button>
          </>
        ) : null}
        <Button type="button" variant="ghost" className="h-8 px-2 text-xs" onClick={() => void copyTextToClipboard(source).then((ok) => {
          if (!ok) return;
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        })}>
          {copied ? <Check className="size-3.5" aria-hidden /> : <Clipboard className="size-3.5" aria-hidden />}
          {copied ? copy.copied : copy.copy}
        </Button>
        <Button type="button" variant="ghost" className="h-8 px-2 text-xs" onClick={download}>
          <Download className="size-3.5" aria-hidden />{copy.download}
        </Button>
      </header>
      {error ? <div className="shrink-0 border-b border-danger/25 bg-danger/5 px-4 py-2 text-xs text-danger">{error}</div> : null}
      <div className="min-h-0 flex-1">
        <JsonEditor
          key={`${resetKey}:${editorRevision}`}
          initialContent={source}
          onChange={updateSource}
          isDark={isDark}
          readOnly={readOnly}
          lineWrap={false}
        />
      </div>
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label={copy.resize}
        title={copy.resize}
        tabIndex={0}
        className="group absolute inset-x-0 bottom-0 z-10 flex h-3 touch-none cursor-row-resize items-end justify-center border-t border-transparent outline-none hover:border-accent/40 focus:border-accent/40"
        onPointerDown={startResize}
        onKeyDown={resizeWithKeyboard}
        onDoubleClick={() => setResizedHeight(null)}
      >
        <span className="mb-1 h-0.5 w-10 rounded-full bg-edge-strong transition-colors group-hover:bg-accent group-focus:bg-accent" />
      </div>
    </section>
  );
}

function sourcePanelCopy(language: StoredLanguage) {
  return language === 'zh'
    ? { title: '工作流定义 · JSON', valid: '有效', invalid: '需要修复', format: '格式化', copy: '复制', copied: '已复制', download: '下载', import: '导入', resize: '上下拖动调整源码区域高度' }
    : { title: 'Workflow definition · JSON', valid: 'Valid', invalid: 'Needs attention', format: 'Format', copy: 'Copy', copied: 'Copied', download: 'Download', import: 'Import', resize: 'Drag vertically to resize the source area' };
}

function clampSourceHeight(height: number): number {
  const viewportMaximum = typeof window === 'undefined' ? 960 : Math.max(280, window.innerHeight - 96);
  return Math.min(viewportMaximum, Math.max(280, Math.round(height)));
}
