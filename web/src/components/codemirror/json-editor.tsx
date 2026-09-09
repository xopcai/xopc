import { useMemo } from 'react';
import { json } from '@codemirror/lang-json';

import { CodeEditor, type CodeEditorProps } from './code-editor';

export type JsonEditorProps = Omit<CodeEditorProps, 'language'>;

export function JsonEditor(props: JsonEditorProps) {
  const jsonLanguage = useMemo(() => json(), []);
  return <CodeEditor {...props} language={jsonLanguage} />;
}
