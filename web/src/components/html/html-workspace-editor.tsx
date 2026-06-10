import { useMemo } from 'react';
import { html } from '@codemirror/lang-html';

import { CodeEditor, type CodeEditorProps } from '@/components/codemirror/code-editor';

export type HtmlWorkspaceEditorProps = Omit<CodeEditorProps, 'language'>;

/**
 * CodeMirror-based HTML source editor.
 *
 * Thin wrapper around `CodeEditor` that wires up the HTML language extension.
 */
export function HtmlWorkspaceEditor(props: HtmlWorkspaceEditorProps) {
  const htmlLang = useMemo(() => html(), []);

  return <CodeEditor {...props} language={htmlLang} />;
}
