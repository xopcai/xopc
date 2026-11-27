import { registerHooks } from 'node:module';

const PI_OAUTH_PAGE_SUFFIX = '/@earendil-works/pi-ai/dist/utils/oauth-page.js';
const HOOK_KEY = Symbol.for('xopc.piOAuthPageHookRegistered');

/**
 * Redirect `@earendil-works/pi-ai`'s OAuth callback HTML module to xopc's own branded page.
 * Covers MCP servers, connectors, plugins, and Pi-backed model OAuth flows in unbundled Node/tsx.
 */
export function registerPiOAuthPageHook(): void {
  const globalState = globalThis as Record<symbol, boolean | undefined>;
  if (globalState[HOOK_KEY] || typeof registerHooks !== 'function') return;
  globalState[HOOK_KEY] = true;

  const hookUrl = import.meta.url;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      const resolved = nextResolve(specifier, context);
      if (!resolved.url.endsWith(PI_OAUTH_PAGE_SUFFIX)) {
        return resolved;
      }
      try {
        return nextResolve('./oauth-page.js', { ...context, parentURL: hookUrl });
      } catch {
        return resolved;
      }
    },
  });
}
