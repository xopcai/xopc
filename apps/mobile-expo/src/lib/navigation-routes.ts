export type NoteDetailOptions = {
  heading?: string;
  range?: { start: number; end: number };
};

type NoteDetailRouteParams = { id: string; heading?: string; start?: string; end?: string };

export function noteDetailRoute(
  noteId: string,
  options?: NoteDetailOptions,
): { pathname: '/items/[id]'; params: NoteDetailRouteParams } {
  const params: NoteDetailRouteParams = { id: noteId };
  if (options?.heading?.trim()) params.heading = options.heading.trim();
  if (options?.range) {
    params.start = String(options.range.start);
    params.end = String(options.range.end);
  }
  return {
    pathname: '/items/[id]',
    params,
  };
}
