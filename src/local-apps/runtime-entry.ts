export const LOCAL_APP_RUNTIME_ENTRY = '.xopc/runtime/local-ui.js';

/**
 * Local UI Apps use host-defined runtime bytes so generated projects cannot execute
 * arbitrary Node.js in the gateway process through the extension `main` entry.
 */
export const LOCAL_APP_RUNTIME_SOURCE = `export default Object.freeze({});
`;
