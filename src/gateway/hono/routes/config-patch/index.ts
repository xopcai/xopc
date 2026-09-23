/**
 * Barrel for `PATCH /api/config` section patchers.
 */
export { applyChannelsPatch } from './channels.js';
export { applyGatewayPatch } from './gateway.js';
export { applyMiscPatch, validateGatewayAfterPatch } from './misc.js';
export { type PatchResult, PATCH_OK, patchError } from './result.js';
