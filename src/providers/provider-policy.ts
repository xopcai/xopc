/** Provider identities removed from xopc's current model contract. */
export function isRetiredModelProvider(provider: string): boolean {
  return provider === 'openai-codex' || provider === 'azure-openai-responses';
}

export function assertCurrentModelProvider(provider: string): void {
  if (provider === 'openai-codex') {
    throw new Error('Provider openai-codex is no longer supported. Select openai/<model-id> and sign in with ChatGPT again under openai.');
  }
  if (provider === 'azure-openai-responses') {
    throw new Error('Provider azure-openai-responses is no longer supported. Update the provider ID and model references to azure; the azure-openai-responses API type remains supported.');
  }
}
