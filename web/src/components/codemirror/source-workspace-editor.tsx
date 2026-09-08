import { useEffect, useMemo, useState } from 'react';
import { LanguageDescription, type LanguageSupport } from '@codemirror/language';

import { CodeEditor, type CodeEditorProps } from '@/components/codemirror/code-editor';
import { codeLanguages } from '@/components/codemirror/languages';

export type SourceWorkspaceEditorProps = Omit<CodeEditorProps, 'language'> & {
  fileName: string;
};

/** CodeMirror source editor with best-effort highlighting for the bundled language set. */
export function SourceWorkspaceEditor({ fileName, ...props }: SourceWorkspaceEditorProps) {
  const description = useMemo(
    () => LanguageDescription.matchFilename(codeLanguages, fileName),
    [fileName],
  );
  const [language, setLanguage] = useState<LanguageSupport>();

  useEffect(() => {
    let cancelled = false;
    setLanguage(undefined);
    if (description) {
      void description.load().then((loaded) => {
        if (!cancelled) setLanguage(loaded);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [description]);

  return <CodeEditor {...props} language={language} />;
}
