import { arrayBufferToBase64 } from '@/features/chat/attachments/attachment-utils-core';
import {
  fetchMediaUriBuffer,
  type FetchMediaUriBinaryResult,
} from '@/features/file-preview/fetch-workspace-relative-file';

/**
 * @deprecated Prefer `fetchMediaUriBlob` / `fetchMediaUriBuffer` for UI.
 */
export async function fetchWorkspaceRelativeFileAsBase64(params: {
  uri: string;
}): Promise<FetchMediaUriBinaryResult | { ok: true; base64: string }> {
  const result = await fetchMediaUriBuffer(params);
  if (!result.ok) {
    return result;
  }
  return { ok: true, base64: arrayBufferToBase64(result.buffer) };
}
