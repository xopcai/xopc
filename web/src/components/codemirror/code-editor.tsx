import { useEffect, useRef } from 'react';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorState, type Extension } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView, keymap, highlightActiveLine, lineNumbers } from '@codemirror/view';

import { appCodeMirrorTheme } from './app-editor-theme';

export interface CodeEditorProps {
  /**
   * Seed document on mount (and when `isDark` toggles, the view is recreated with the current prop).
   * To load different files, remount the editor (e.g. `key` on the parent) instead of relying on prop updates.
   */
  initialContent: string;
  /** Fires on every doc change; debounce in the parent if needed. */
  onChange: (content: string) => void;
  /** Language extension — e.g. `markdown(…)` or `html()`. When omitted, no syntax highlighting is applied. */
  language?: Extension;
  isDark?: boolean;
  className?: string;
}

/**
 * Thin CodeMirror wrapper used across the app for source-level editing
 * (Markdown profile files, HTML workspace editor, cron prompts, etc.).
 *
 * For WYSIWYG rich-text editing, see `BlockEditor` (Tiptap).
 */
export function CodeEditor({
  initialContent,
  onChange,
  language,
  isDark = false,
  className,
}: CodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const seedRef = useRef(initialContent);
  seedRef.current = initialContent;

  useEffect(() => {
    if (!containerRef.current) return;

    const extensions: Extension[] = [
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
    ];

    if (language) {
      extensions.unshift(language);
    }

    const state = EditorState.create({
      doc: seedRef.current,
      extensions,
    });

    editorRef.current = new EditorView({ state, parent: containerRef.current });

    return () => {
      editorRef.current?.destroy();
      editorRef.current = null;
    };
  }, [isDark, language]);

  return <div ref={containerRef} className={`size-full overflow-hidden ${className ?? ''}`} />;
}
