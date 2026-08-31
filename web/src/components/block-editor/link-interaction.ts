import type { Editor } from '@tiptap/react';

export function editSelectedLink(editor: Editor): void {
  const previousUrl = String(editor.getAttributes('link').href ?? '');
  const url = window.prompt('URL', previousUrl);
  if (url === null) return;
  if (!url.trim()) {
    editor.chain().focus().extendMarkRange('link').unsetLink().run();
    return;
  }
  editor.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run();
}

export function modifiedClickLinkHref(event: MouseEvent): string | null {
  if (!event.metaKey && !event.ctrlKey) return null;
  const target = event.target instanceof Element ? event.target : null;
  return target?.closest<HTMLAnchorElement>('a[href]')?.getAttribute('href')?.trim() || null;
}
