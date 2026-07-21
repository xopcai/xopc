export const LOCAL_APP_RUNTIME_ENTRY = '.xopc/runtime/local-ui.js';

/**
 * Local UI Apps use host-defined runtime bytes so generated projects cannot execute
 * arbitrary Node.js in the gateway process through the extension `main` entry.
 */
export const LOCAL_APP_RUNTIME_SOURCE = `export default Object.freeze({});
`;

/** Exact legacy scaffold bytes accepted only to keep existing Phase 1 drafts upgradeable. */
export function legacyLocalAppRuntimeSource(extensionId: string, name: string): string {
  return `export default {
  id: ${JSON.stringify(extensionId)},
  name: ${JSON.stringify(name)},
  version: '0.1.0',
  kind: 'utility',
  register(api) {
    api.logger.info('Local app registered');
  },
};
`;
}
