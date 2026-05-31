/**
 * Barrel for `PATCH /api/config` section patchers. See `agents.ts`,
 * `channels.ts`, `gateway.ts`, `misc.ts` for the per-section split.
 */
export { applyAgentsPatch } from './agents.js';
export { applyChannelsPatch } from './channels.js';
export { applyGatewayPatch } from './gateway.js';
export { applyMiscPatch, validateGatewayAfterPatch } from './misc.js';
export { type PatchResult, PATCH_OK, patchError } from './result.js';
