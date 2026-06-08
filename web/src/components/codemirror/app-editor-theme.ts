import { EditorView } from '@codemirror/view';

/** Editor chrome aligned with gateway console design tokens (light/dark via CSS variables). */
export const appCodeMirrorTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '14px',
    backgroundColor: 'var(--color-surface-base)',
    color: 'var(--color-fg)',
  },
  '.cm-scroller': {
    fontFamily: 'var(--font-mono)',
    lineHeight: '1.7',
    overflow: 'auto',
  },
  '.cm-content': {
    padding: '16px 20px',
    caretColor: 'var(--color-fg)',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--color-fg)',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--color-surface-base)',
    color: 'var(--color-fg-subtle)',
    borderRight: '1px solid var(--color-edge-subtle)',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    color: 'var(--color-fg-subtle)',
    minWidth: '2.25rem',
    paddingRight: '0.5rem',
  },
  '.cm-activeLineGutter': {
    color: 'var(--color-fg-muted)',
    backgroundColor: 'var(--color-surface-hover)',
  },
  '.cm-activeLine': {
    backgroundColor: 'var(--color-surface-hover)',
  },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: 'color-mix(in srgb, var(--color-accent) 22%, transparent)',
  },
  '.cm-focused': { outline: 'none' },
});
