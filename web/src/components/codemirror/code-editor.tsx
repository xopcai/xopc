import { useEffect, useRef } from 'react';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView, keymap, highlightActiveLine, lineNumbers, type KeyBinding } from '@codemirror/view';

import type { EditorTextSelection } from '@/components/editor-text-selection';

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
  lineWrap?: boolean;
  readOnly?: boolean;
  keyBindings?: readonly KeyBinding[];
  onTextSelection?: (selection: EditorTextSelection | null) => void;
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
  lineWrap = false,
  readOnly = false,
  keyBindings,
  onTextSelection,
}: CodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<EditorView | null>(null);
  const lineWrapCompartmentRef = useRef(new Compartment());
  const keymapCompartmentRef = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const selectionCallback = useRef(onTextSelection);
  selectionCallback.current = onTextSelection;
  const seedRef = useRef(initialContent);
  seedRef.current = initialContent;
  const keyBindingsRef = useRef(keyBindings);
  keyBindingsRef.current = keyBindings;

  useEffect(() => {
    if (!containerRef.current) return;

    const extensions: Extension[] = [
      lineNumbers(),
      highlightActiveLine(),
      history(),
      isDark ? oneDark : syntaxHighlighting(defaultHighlightStyle),
      keymapCompartmentRef.current.of(keymap.of([
        ...(keyBindingsRef.current ?? []),
        ...defaultKeymap,
        ...historyKeymap,
      ])),
      lineWrapCompartmentRef.current.of(lineWrap ? EditorView.lineWrapping : []),
      EditorState.readOnly.of(readOnly),
      EditorView.editable.of(!readOnly),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) selectionCallback.current?.(null);
        else if (update.selectionSet && selectionCallback.current) {
          const { from, to, empty } = update.state.selection.main;
          if (empty || update.state.selection.ranges.length !== 1) selectionCallback.current(null);
          else {
            const view = update.view; const document = update.state.doc;
            // CodeMirror forbids layout reads during its update phase.
            queueMicrotask(() => {
              if (editorRef.current !== view || !view.state.doc.eq(document) || view.state.selection.main.from !== from || view.state.selection.main.to !== to) return;
              const start = view.coordsAtPos(from); const end = view.coordsAtPos(to);
              if (start && end) selectionCallback.current?.({ text: document.sliceString(from,to),
                rect: { left: Math.min(start.left,end.left), right: Math.max(start.right,end.right), top: start.top, bottom: end.bottom },
                insertAfter: markdown => {
                  if (editorRef.current !== view || !view.state.doc.eq(document)) return false;
                  view.dispatch({ changes: { from: to, insert: `\n\n${markdown}\n` } }); view.focus(); return true;
                },
                restore: () => { if (editorRef.current === view && view.state.doc.eq(document)) { view.dispatch({ selection: { anchor: from, head: to } }); view.focus(); } },
              });
            });
          }
        }
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
  }, [isDark, language, readOnly]);

  useEffect(() => {
    editorRef.current?.dispatch({
      effects: lineWrapCompartmentRef.current.reconfigure(lineWrap ? EditorView.lineWrapping : []),
    });
  }, [lineWrap]);

  useEffect(() => {
    editorRef.current?.dispatch({
      effects: keymapCompartmentRef.current.reconfigure(keymap.of([
        ...(keyBindings ?? []),
        ...defaultKeymap,
        ...historyKeymap,
      ])),
    });
  }, [keyBindings]);

  return <div ref={containerRef} className={`size-full overflow-hidden ${className ?? ''}`} />;
}
