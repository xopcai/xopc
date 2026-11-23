import type { Editor } from '@tiptap/react';

export function applyLinkHref(editor: Editor, rawUrl: string): void {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    editor.chain().focus().extendMarkRange('link').unsetLink().run();
    return;
  }
  const normalized = /^[a-zA-Z][a-zA-Z\d+.-]*:|^\//.test(trimmed) ? trimmed : `https://${trimmed}`;
  const { empty } = editor.state.selection;
  if (empty && !editor.isActive('link')) {
    editor
      .chain()
      .focus()
      .insertContent({
        type: 'text',
        text: trimmed,
        marks: [{ type: 'link', attrs: { href: normalized } }],
      })
      .run();
    return;
  }
  editor.chain().focus().extendMarkRange('link').setLink({ href: normalized }).run();
}

export function editSelectedLink(editor: Editor): void {
  const previousUrl = String(editor.getAttributes('link').href ?? '');
  if (typeof window.prompt !== 'function') return;
  let url: string | null = null;
  try {
    url = window.prompt('URL', previousUrl);
  } catch {
    return;
  }
  if (url === null) return;
  applyLinkHref(editor, url);
}

export function modifiedClickLinkHref(event: MouseEvent): string | null {
  if (!event.metaKey && !event.ctrlKey) return null;
  const target = event.target instanceof Element ? event.target : null;
  return target?.closest<HTMLAnchorElement>('a[href]')?.getAttribute('href')?.trim() || null;
}
