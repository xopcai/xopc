let registered = false;

/** Include pi-ai OAuth flows in the bundle and evaluate them on first use. */
export async function registerBundledOAuthFlows(): Promise<void> {
  if (registered) return;
  const { registerBunOAuthFlows } = await import('@earendil-works/pi-ai/bun-oauth');
  if (registered) return;
  registerBunOAuthFlows();
  registered = true;
}
