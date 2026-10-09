import { isChatPreviewPath } from '@/lib/chat-preview-origin';
import { withDetailReturnTo } from '@/lib/navigation-return';

export const NOTE_PREVIEW_MODAL_PARAM = 'note';

export function closeNotePreviewModalHref(pathname: string, rawSearch: string): string {
  const search = new URLSearchParams(rawSearch);
  search.delete(NOTE_PREVIEW_MODAL_PARAM);
  const query = search.toString();
  return query ? `${pathname}?${query}` : pathname;
}

/** Keep chat mounted while previewing a note. Other origins open the full page. */
export function noteDetailHref(backgroundPath: string, noteId: string): string {
  const [pathname, rawSearch = ''] = backgroundPath.split('?');
  if (!isChatPreviewPath(pathname)) {
    return withDetailReturnTo(`/notes/${encodeURIComponent(noteId)}`, backgroundPath);
  }
  const search = new URLSearchParams(rawSearch);
  search.delete('task');
  search.delete('preview');
  search.set(NOTE_PREVIEW_MODAL_PARAM, noteId);
  return `${pathname}?${search.toString()}`;
}

export function modalizeNoteDetailHref(backgroundPath: string, href: string): string {
  const match = /^\/notes\/([^/?#]+)(?:\?.*)?$/.exec(href);
  if (!match) return href;
  const query = new URLSearchParams(href.split('?')[1] ?? '');
  if (query.has('edit') || query.has('action')) return href;
  try {
    return noteDetailHref(backgroundPath, decodeURIComponent(match[1]));
  } catch {
    return noteDetailHref(backgroundPath, match[1]);
  }
}
