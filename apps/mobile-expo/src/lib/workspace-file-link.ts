export type WorkspaceFileLinkTarget = {
  path: string;
};

const WORKSPACE_FILE_PROTOCOLS = new Set(['xopc:', 'xopc-mobile:']);

/** Parse the workspace-file links emitted in assistant Markdown. */
export function parseWorkspaceFileLink(value: string): WorkspaceFileLinkTarget | null {
  try {
    const url = new URL(value);
    if (
      !WORKSPACE_FILE_PROTOCOLS.has(url.protocol)
      || url.hostname !== 'workspace'
      || url.pathname.replace(/\/+$/, '') !== '/file'
    ) return null;
    const path = url.searchParams.get('path')?.trim();
    return path ? { path } : null;
  } catch {
    return null;
  }
}

export function workspaceFileLinkRoute(value: string, conversationId?: string | null): {
  pathname: '/workspace/file';
  params: { path: string; conversationId?: string };
} | null {
  const target = parseWorkspaceFileLink(value);
  if (!target) return null;
  const normalizedConversationId = conversationId?.trim();
  return {
    pathname: '/workspace/file',
    params: {
      path: target.path,
      ...(normalizedConversationId ? { conversationId: normalizedConversationId } : {}),
    },
  };
}
