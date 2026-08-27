import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

const DEFAULT_MAX_OUTPUT_CHARS = 20_000;

export function prepareTerminalOutput(
  raw: string,
  maxChars = DEFAULT_MAX_OUTPUT_CHARS,
): { output: string; truncated: boolean } {
  const clean = raw
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[@-_]/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[^\x09\x0a\x20-\x7e\u00a0-\uffff]/g, '')
    .trim();
  if (clean.length <= maxChars) return { output: clean, truncated: false };
  return { output: clean.slice(-maxChars), truncated: true };
}

export async function shareTerminalOutput(
  sessionKey: string,
  rawOutput: string,
): Promise<{ truncated: boolean }> {
  const prepared = prepareTerminalOutput(rawOutput);
  if (!prepared.output) throw new Error('Terminal output is empty');
  await fetchJson(apiUrl(`/api/sessions/${encodeURIComponent(sessionKey)}/transcript/bash`), {
    method: 'POST',
    body: JSON.stringify({
      command: 'Terminal output shared by user',
      output: prepared.output,
      exitCode: null,
      truncated: prepared.truncated,
    }),
  });
  return { truncated: prepared.truncated };
}
