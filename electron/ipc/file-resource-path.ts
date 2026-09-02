import { isAbsolute } from 'node:path';

import { getGatewayConnection } from '../gateway-process.js';

export type ResolvedFileResourcePath =
  | { ok: true; path: string }
  | { ok: false; error: string; code: 'INVALID_FILE' | 'NOT_FOUND' };

export async function resolveFileResourceHostPath(fileResourceId: unknown): Promise<ResolvedFileResourcePath> {
  if (typeof fileResourceId !== 'string' || !fileResourceId.trim() || fileResourceId.length > 8_192) {
    return { ok: false, code: 'INVALID_FILE', error: 'Invalid file resource.' };
  }
  const connection = getGatewayConnection();
  if (!connection) {
    return { ok: false, code: 'NOT_FOUND', error: 'Local file service is unavailable.' };
  }
  try {
    const response = await fetch(
      `http://127.0.0.1:${connection.port}/api/files/${encodeURIComponent(fileResourceId)}/host-path`,
      {
        headers: { Authorization: `Bearer ${connection.token}` },
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (!response.ok) {
      return { ok: false, code: 'NOT_FOUND', error: `File is unavailable (${response.status}).` };
    }
    const body = await response.json() as { absolutePath?: unknown };
    if (typeof body.absolutePath !== 'string' || !isAbsolute(body.absolutePath)) {
      return { ok: false, code: 'NOT_FOUND', error: 'File location is unavailable.' };
    }
    return { ok: true, path: body.absolutePath };
  } catch (error) {
    return {
      ok: false,
      code: 'NOT_FOUND',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
