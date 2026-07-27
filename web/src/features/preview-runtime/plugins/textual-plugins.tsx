import { lazy, Suspense, useEffect, useMemo, useRef } from 'react';

import { MarkdownView } from '@/components/markdown/markdown-view';
import type { PreviewRuntimeRenderProps } from '@/features/preview-runtime/preview-types';

const loadMarkdownSplit = () => import('@/components/markdown/markdown-split');
const loadHtmlWorkspaceEditor = () => import('@/components/html/html-workspace-editor');

const MarkdownSplit = lazy(() => loadMarkdownSplit().then((m) => ({ default: m.MarkdownSplit })));
const HtmlWorkspaceEditor = lazy(() =>
  loadHtmlWorkspaceEditor().then((m) => ({ default: m.HtmlWorkspaceEditor })),
);

function EditorLoadingFallback() {
  return (
    <div className="flex h-full min-h-0 flex-col px-4 py-3" aria-busy>
      <div className="h-4 w-11/12 animate-pulse rounded bg-surface-hover" />
      <div className="mt-3 h-4 w-9/12 animate-pulse rounded bg-surface-hover" />
      <div className="mt-3 h-4 w-10/12 animate-pulse rounded bg-surface-hover" />
    </div>
  );
}

function extensionFor(path: string): string {
  const i = path.lastIndexOf('.');
  return i > 0 ? path.slice(i).toLowerCase() : '';
}

function codeFenceLanguage(fileName: string): string {
  const ext = extensionFor(fileName);
  const map: Record<string, string> = {
    '.ts': 'typescript',
    '.tsx': 'tsx',
    '.js': 'javascript',
    '.jsx': 'jsx',
    '.json': 'json',
    '.css': 'css',
    '.yml': 'yaml',
    '.yaml': 'yaml',
    '.py': 'python',
    '.go': 'go',
    '.rs': 'rust',
    '.sh': 'bash',
  };
  return map[ext] ?? 'plaintext';
}

function LineNumberedTextPreview({ text, targetLine }: { text: string; targetLine: number }) {
  const targetRef = useRef<HTMLDivElement | null>(null);
  const lines = useMemo(() => text.split(/\r\n|\n|\r/), [text]);

  useEffect(() => {
    targetRef.current?.scrollIntoView({ block: 'center' });
  }, [targetLine, text]);

  return (
    <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
      <div className="min-w-max font-mono text-xs leading-relaxed text-fg">
        {lines.map((line, index) => {
          const n = index + 1;
          const active = n === targetLine;
          return (
            <div
              key={n}
              ref={active ? targetRef : undefined}
              className={active ? 'flex bg-accent-soft/60 text-fg' : 'flex'}
              data-line={n}
            >
              <span className="w-12 shrink-0 select-none pr-3 text-right text-fg-subtle">{n}</span>
              <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{line || ' '}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function renderTextLike(props: PreviewRuntimeRenderProps, mode: 'text' | 'markdown' | 'code' | 'html') {
  const text = props.textContent ?? '';
  const isWorkspace = props.descriptor.context === 'workspace';
  const editing = props.workspaceEditing;

  if (mode === 'markdown') {
    if (isWorkspace && editing?.markdownEditMode) {
      return (
        <div className="min-h-0 flex-1 overflow-hidden">
          <Suspense fallback={<EditorLoadingFallback />}>
            <MarkdownSplit
              key={props.descriptor.id}
              initialContent={text}
              onSave={(c) => void editing?.onSaveMarkdown?.(c)}
              isDark={(editing?.isDark ?? (props.resolvedTheme === 'dark')) === true}
              wordWrap={editing?.markdownWordWrap === true}
              onToggleWordWrap={editing?.onToggleMarkdownWordWrap}
            />
          </Suspense>
        </div>
      );
    }
    return (
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <MarkdownView content={text} />
      </div>
    );
  }

  if (mode === 'html') {
    if (isWorkspace && editing?.htmlCodeMode) {
      return (
        <div className="min-h-0 flex-1 overflow-hidden">
          <Suspense fallback={<EditorLoadingFallback />}>
            <HtmlWorkspaceEditor
              key={props.descriptor.id}
              initialContent={text}
              onChange={(v) => editing?.onHtmlChange?.(v)}
              isDark={(editing?.isDark ?? (props.resolvedTheme === 'dark')) === true}
            />
          </Suspense>
        </div>
      );
    }
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-2 pb-2 pt-1 sm:px-4">
        <iframe
          title={props.descriptor.fileName}
          className="min-h-0 w-full flex-1 rounded-lg border border-edge-subtle bg-white dark:border-edge dark:bg-[#1e1e1e]"
          srcDoc={text}
          sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-downloads allow-forms allow-modals"
        />
      </div>
    );
  }

  if (props.targetLine && props.targetLine > 0) {
    return <LineNumberedTextPreview text={text} targetLine={props.targetLine} />;
  }

  if (mode === 'code') {
    const lang = codeFenceLanguage(props.descriptor.fileName);
    return (
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <MarkdownView content={`\`\`\`${lang}\n${text}\n\`\`\``} />
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
      <pre className="whitespace-pre-wrap break-words font-mono text-xs text-fg">{text}</pre>
    </div>
  );
}

export function TextPreviewPluginView(props: PreviewRuntimeRenderProps) {
  return renderTextLike(props, 'text');
}

export function MarkdownPreviewPluginView(props: PreviewRuntimeRenderProps) {
  return renderTextLike(props, 'markdown');
}

export function CodePreviewPluginView(props: PreviewRuntimeRenderProps) {
  return renderTextLike(props, 'code');
}

export function HtmlPreviewPluginView(props: PreviewRuntimeRenderProps) {
  return renderTextLike(props, 'html');
}
