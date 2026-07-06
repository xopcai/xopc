/** Path for gateway raw workspace reads; `rel` is relative to the session/agent workspace. */
export function workspaceRelativePathToApiPath(
  rel: string,
  opts?: { sessionKey?: string | null; agentId?: string | null },
): string {
  const norm = rel.replace(/\\/g, '/');
  const params = new URLSearchParams({ path: norm });
  const sk = opts?.sessionKey?.trim();
  const agentId = opts?.agentId?.trim();
  if (sk) params.set('sessionKey', sk);
  else if (agentId) params.set('agentId', agentId);
  return `/api/workspace/editor/raw?${params.toString()}`;
}
