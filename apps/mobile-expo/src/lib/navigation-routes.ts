export type NoteDetailOptions = {
  heading?: string;
  range?: { start: number; end: number };
};

type NoteDetailRouteParams = { id: string; heading?: string; start?: string; end?: string };
type ChatRouteParams = { k: string; msg?: string; taskId?: string };

export function chatRoute(
  key: string,
  options?: { msg?: string; taskId?: string },
): { pathname: '/chat/[k]'; params: ChatRouteParams } {
  const params: ChatRouteParams = { k: key };
  if (options?.msg) params.msg = options.msg;
  if (options?.taskId) params.taskId = options.taskId;
  return { pathname: '/chat/[k]', params };
}

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
