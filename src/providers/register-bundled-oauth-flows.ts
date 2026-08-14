import { registerBunOAuthFlows } from '@earendil-works/pi-ai/bun-oauth';

let registered = false;

/** Statically include pi-ai OAuth flows for single-file runtimes such as Electron. */
export function registerBundledOAuthFlows(): void {
  if (registered) return;
  registerBunOAuthFlows();
  registered = true;
}
