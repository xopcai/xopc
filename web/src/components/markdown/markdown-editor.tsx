import { useEffect, useRef } from 'react';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { EditorState } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView, keymap, highlightActiveLine, lineNumbers } from '@codemirror/view';

export interface MarkdownEditorProps {
  /**
   * Seed document on mount (and when `isDark` toggles, the view is recreated with the current prop).
   * To load different files, remount the editor (e.g. `key` on the parent) instead of relying on prop updates.
   */
  initialContent: string;
  /** Fires on every doc change; debounce in the parent if needed. */
  onChange: (content: string) => void;
  isDark?: boolean;
  className?: string;
}

export function MarkdownEditor({
  initialContent,
  onChange,
  isDark = false,
  className,
}: MarkdownEditorProps) {
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
        markdown({ base: markdownLanguage, codeLanguages: languages }),
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
        EditorView.theme({
          '&': { height: '100%', fontSize: '14px' },
          '.cm-scroller': {
            fontFamily: 'var(--font-mono)',
            lineHeight: '1.7',
            overflow: 'auto',
          },
          '.cm-content': { padding: '16px 20px' },
          '.cm-focused': { outline: 'none' },
        }),
      ],
    });

    editorRef.current = new EditorView({ state, parent: containerRef.current });

    return () => {
      editorRef.current?.destroy();
      editorRef.current = null;
    };
  }, [isDark]);

  return <div ref={containerRef} className={`h-full w-full overflow-hidden ${className ?? ''}`} />;
}
