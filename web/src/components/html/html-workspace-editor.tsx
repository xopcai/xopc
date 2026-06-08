import { useEffect, useRef } from 'react';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { html } from '@codemirror/lang-html';
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView, keymap, highlightActiveLine, lineNumbers } from '@codemirror/view';

import { appCodeMirrorTheme } from '@/components/codemirror/app-editor-theme';

export interface HtmlWorkspaceEditorProps {
  /** Seed on mount; remount via `key` when switching files. */
  initialContent: string;
  onChange: (content: string) => void;
  isDark?: boolean;
  className?: string;
}

export function HtmlWorkspaceEditor({
  initialContent,
  onChange,
  isDark = false,
  className,
}: HtmlWorkspaceEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const seedRef = useRef(initialContent);
  seedRef.current = initialContent;

  useEffect(() => {
    if (!containerRef.current) return;

    const state = EditorState.create({
      doc: seedRef.current,
      extensions: [
        html(),
        lineNumbers(),
        highlightActiveLine(),
        history(),
        isDark ? oneDark : syntaxHighlighting(defaultHighlightStyle),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString());
          }
        }),
        appCodeMirrorTheme,
      ],
    });

    editorRef.current = new EditorView({ state, parent: containerRef.current });

    return () => {
      editorRef.current?.destroy();
      editorRef.current = null;
    };
  }, [isDark]);

  return <div ref={containerRef} className={`size-full overflow-hidden ${className ?? ''}`} />;
}
