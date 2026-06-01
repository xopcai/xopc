/**
 * Shared result type for fallible `PATCH /api/config` section patchers.
 *
 * Patchers that can reject malformed input return `{ ok: false, status,
 * error }`; the route dispatcher converts that into `c.json(error, status)`.
 * Patchers that never fail (agents, channels) return `void` instead.
 */
export type PatchResult = { ok: true } | { ok: false; status: number; error: { message: string } };

export const PATCH_OK: PatchResult = { ok: true };

export function patchError(message: string, status = 400): PatchResult {
  return { ok: false, status, error: { message } };
}
