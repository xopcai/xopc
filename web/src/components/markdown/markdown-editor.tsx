import { useMemo } from 'react';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';

import { CodeEditor, type CodeEditorProps } from '@/components/codemirror/code-editor';
import { codeLanguages } from '@/components/codemirror/languages';

export type MarkdownEditorProps = Omit<CodeEditorProps, 'language'>;

/**
 * CodeMirror-based Markdown source editor.
 *
 * Thin wrapper around `CodeEditor` that wires up the Markdown language
 * extension with a curated set of fenced-code-block grammars.
 */
export function MarkdownEditor(props: MarkdownEditorProps) {
  const markdownLang = useMemo(
    () => markdown({ base: markdownLanguage, codeLanguages }),
    [],
  );

  return <CodeEditor {...props} language={markdownLang} />;
}
