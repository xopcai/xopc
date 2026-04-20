/** Injected at build time by Vite (`vite.config.ts` `define`). */
export const webBuildInfo = {
  version: __XOPC_WEB_VERSION__,
  commit: __XOPC_WEB_COMMIT__,
  buildTimeIso: __XOPC_WEB_BUILD_TIME__,
} as const;
