export const TASK_DETAIL_MODAL_PARAM = 'task';

export function taskDetailModalHref(backgroundPath: string, taskId: string): string {
  const [pathname, rawSearch = ''] = backgroundPath.split('?');
  const search = new URLSearchParams(rawSearch);
  search.set(TASK_DETAIL_MODAL_PARAM, taskId);
  return `${pathname}?${search.toString()}`;
}

export function modalizeTaskDetailHref(backgroundPath: string, href: string): string {
  const match = /^\/tasks\/([^/?#]+)/.exec(href);
  if (!match) return href;

  try {
    return taskDetailModalHref(backgroundPath, decodeURIComponent(match[1]));
  } catch {
    return taskDetailModalHref(backgroundPath, match[1]);
  }
}

export function closeTaskDetailModalHref(pathname: string, rawSearch: string): string {
  const search = new URLSearchParams(rawSearch);
  search.delete(TASK_DETAIL_MODAL_PARAM);
  const query = search.toString();
  return query ? `${pathname}?${query}` : pathname;
}
