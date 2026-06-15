export function isAppendOnlyLlmTranscriptMessage(message: unknown): boolean {
  if (!message || typeof message !== 'object') {
    return false;
  }
  const role = (message as { role?: string }).role;
  return role === 'user' || role === 'assistant' || role === 'tool' || role === 'toolResult';
}
