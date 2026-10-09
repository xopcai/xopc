import { modalizeNoteDetailHref } from '@/features/notes/note-detail-route';
import { modalizeTaskDetailHref } from '@/features/tasks/task-detail-route';

export const PRODUCT_PREVIEW_PARAM = 'preview';
export type ProductPreviewKind = 'project' | 'workflow_run' | 'workflow_definition' | 'automation' | 'local_app';
export type ProductPreviewTarget = { kind: ProductPreviewKind; id: string; href: string; ownerAgentId?: string; sourceHash?: string };

/** Only viewing an object is eligible; editing, creating and using it stay on pages. */
export function resolveProductPreviewTarget(href: string): ProductPreviewTarget | null {
  if (!href.startsWith('/') || href.startsWith('//') || href.includes('\\') || href.includes('#')) return null;
  const url = new URL(href, 'https://xopc.local');
  if (['edit', 'copy', 'action', 'draft', 'add', 'autogenerate'].some((key) => url.searchParams.has(key))) return null;
  let kind: ProductPreviewKind;
  let rawId: string | undefined;
  let match: RegExpExecArray | null;
  if ((match = /^\/projects\/([^/]+)$/.exec(url.pathname))) { kind = 'project'; rawId = match[1]; }
  else if ((match = /^\/workflows\/runs\/([^/]+)$/.exec(url.pathname))) { kind = 'workflow_run'; rawId = match[1]; }
  else if ((match = /^\/workflows\/([^/]+)$/.exec(url.pathname))) { kind = 'workflow_definition'; rawId = match[1]; }
  else if (url.pathname === '/workflows' && url.searchParams.get('run')) { kind = 'workflow_run'; rawId = encodeURIComponent(url.searchParams.get('run')!); }
  else if (url.pathname === '/workflows' && url.searchParams.get('def')) { kind = 'workflow_definition'; rawId = encodeURIComponent(url.searchParams.get('def')!); }
  else if (url.pathname === '/automations' && url.searchParams.get('automation')) { kind = 'automation'; rawId = encodeURIComponent(url.searchParams.get('automation')!); }
  else if ((match = /^\/local-apps\/([^/]+)$/.exec(url.pathname))) { kind = 'local_app'; rawId = match[1]; }
  else if (url.pathname === '/open' && url.searchParams.get('kind') === 'local_app' && url.searchParams.get('id')) { kind = 'local_app'; rawId = encodeURIComponent(url.searchParams.get('id')!); }
  else return null;
  let id: string;
  try { id = decodeURIComponent(rawId); } catch { return null; }
  if (!id.trim() || (kind === 'workflow_definition' && id === 'new')) return null;
  const ownerAgentId = url.searchParams.get('agentId') || url.searchParams.get('agent') || undefined;
  const sourceHash = url.searchParams.get('sourceHash') || undefined;
  const params = new URLSearchParams(url.searchParams);
  for (const key of ['run', 'def', 'agent', 'returnTo']) params.delete(key);
  if (ownerAgentId) params.set('agentId', ownerAgentId);
  let path = kind === 'project' ? `/projects/${encodeURIComponent(id)}`
    : kind === 'workflow_run' ? `/workflows/runs/${encodeURIComponent(id)}`
      : kind === 'workflow_definition' ? `/workflows/${encodeURIComponent(id)}`
        : kind === 'automation' ? '/automations' : `/local-apps/${encodeURIComponent(id)}`;
  if (kind === 'automation') params.set('automation', id);
  if (kind === 'local_app') { params.delete('kind'); params.delete('id'); }
  path += params.size ? `?${params.toString()}` : '';
  return { kind, id, href: path, ownerAgentId, sourceHash };
}

export function closeProductPreviewHref(pathname: string, rawSearch: string): string {
  const params = new URLSearchParams(rawSearch);
  params.delete(PRODUCT_PREVIEW_PARAM);
  return `${pathname}${params.size ? `?${params.toString()}` : ''}`;
}

export function chatProductHref(backgroundPath: string, href: string): string {
  const [pathname, rawSearch = ''] = backgroundPath.split('?');
  const isChat = pathname === '/chat' || pathname.startsWith('/chat/');
  const target = isChat ? resolveProductPreviewTarget(href) : null;
  if (!target) return modalizeNoteDetailHref(backgroundPath, modalizeTaskDetailHref(backgroundPath, href));
  const params = new URLSearchParams(rawSearch);
  params.delete('note');
  params.delete('task');
  params.set(PRODUCT_PREVIEW_PARAM, target.href);
  return `${pathname}?${params.toString()}`;
}
