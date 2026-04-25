import { arrayBufferToBase64, workspaceRelativePathToApiPath } from '@/features/chat/attachment-utils-core';
import { apiFetch } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export type FetchWorkspaceRelativeBinaryResult =
  | { ok: true; base64: string }
  | { ok: false; reason: 'http'; status: number }
  | { ok: false; reason: 'network'; message: string };

/**
 * Load a workspace-relative file as base64 via the gateway (same URL shape as attachment preview / tile hydration).
 */
export async function fetchWorkspaceRelativeFileAsBase64(params: {
  workspaceRelativePath: string;
  sessionKey?: string | null;
}): Promise<FetchWorkspaceRelativeBinaryResult> {
  const { workspaceRelativePath, sessionKey } = params;
  try {
    const url = apiUrl(workspaceRelativePathToApiPath(workspaceRelativePath, { sessionKey }));
    const res = await apiFetch(url);
    if (!res.ok) {
      return { ok: false, reason: 'http', status: res.status };
    }
    const buf = await res.arrayBuffer();
    return { ok: true, base64: arrayBufferToBase64(buf) };
  } catch (e) {
    return { ok: false, reason: 'network', message: e instanceof Error ? e.message : String(e) };
  }
}
