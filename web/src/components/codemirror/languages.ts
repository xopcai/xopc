import { LanguageDescription } from '@codemirror/language';

/**
 * Curated subset of code-fence languages for Markdown editing.
 *
 * The full `@codemirror/language-data` bundle (~1 MB raw) includes dozens of
 * rarely-used grammars. This module lazy-loads only the languages that appear
 * most often in our users' notes and agent profiles, cutting the
 * `vendor-codemirror` chunk by roughly 60-70 %.
 *
 * Each entry uses dynamic `import()` so the grammar is only fetched when a
 * matching fenced code block is encountered in the editor.
 */
export const codeLanguages: LanguageDescription[] = [
  LanguageDescription.of({
    name: 'JavaScript',
    alias: ['js', 'jsx', 'mjs', 'cjs'],
    extensions: ['js', 'jsx', 'mjs', 'cjs'],
    load: () => import('@codemirror/lang-javascript').then((m) => m.javascript({ jsx: true })),
  }),
  LanguageDescription.of({
    name: 'TypeScript',
    alias: ['ts', 'tsx', 'mts', 'cts'],
    extensions: ['ts', 'tsx', 'mts', 'cts'],
    load: () =>
      import('@codemirror/lang-javascript').then((m) => m.javascript({ jsx: true, typescript: true })),
  }),
  LanguageDescription.of({
    name: 'JSON',
    alias: ['jsonc', 'json5'],
    extensions: ['json'],
    load: () => import('@codemirror/lang-json').then((m) => m.json()),
  }),
  LanguageDescription.of({
    name: 'HTML',
    alias: ['htm'],
    extensions: ['html', 'htm'],
    load: () => import('@codemirror/lang-html').then((m) => m.html()),
  }),
  LanguageDescription.of({
    name: 'CSS',
    alias: ['scss', 'less'],
    extensions: ['css', 'scss', 'less'],
    load: () => import('@codemirror/lang-css').then((m) => m.css()),
  }),
  LanguageDescription.of({
    name: 'Python',
    alias: ['py'],
    extensions: ['py', 'pyw'],
    load: () => import('@codemirror/lang-python').then((m) => m.python()),
  }),
  LanguageDescription.of({
    name: 'Markdown',
    alias: ['md', 'mkd'],
    extensions: ['md', 'markdown'],
    load: () => import('@codemirror/lang-markdown').then((m) => m.markdown()),
  }),
  LanguageDescription.of({
    name: 'YAML',
    alias: ['yml'],
    extensions: ['yaml', 'yml'],
    load: () => import('@codemirror/lang-yaml').then((m) => m.yaml()),
  }),
];
