import type { EndpointToolDescriptor } from '@xopcai/endpoint-tools-protocol';

export const WEB_ENDPOINT_TOOLS = [
  {
    name: 'web.page.get_selection',
    title: 'Read selected text',
    description: 'Read the text currently selected in this browser tab.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    effect: 'read',
    confirmation: 'never',
    requiresForeground: true,
    requiredPermissions: [],
    timeoutMs: 10_000,
    maxConcurrency: 1,
    supportsCancellation: false,
    idempotent: true,
    resultKinds: ['text'],
  },
  {
    name: 'web.clipboard.write',
    title: 'Write clipboard',
    description: 'Write text to the clipboard from this browser tab.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', maxLength: 100_000 } },
      required: ['text'],
      additionalProperties: false,
    },
    effect: 'write',
    confirmation: 'always',
    requiresForeground: true,
    requiredPermissions: ['clipboard-write'],
    timeoutMs: 30_000,
    maxConcurrency: 1,
    supportsCancellation: false,
    idempotent: true,
    resultKinds: ['text'],
  },
  {
    name: 'web.page.navigate',
    title: 'Navigate page',
    description: 'Navigate this browser tab to an HTTP or HTTPS URL.',
    inputSchema: {
      type: 'object',
      properties: { url: { type: 'string', maxLength: 4_096 } },
      required: ['url'],
      additionalProperties: false,
    },
    effect: 'destructive',
    confirmation: 'always',
    requiresForeground: true,
    requiredPermissions: ['navigation'],
    timeoutMs: 30_000,
    maxConcurrency: 1,
    supportsCancellation: false,
    idempotent: false,
    resultKinds: ['text'],
  },
] as const satisfies readonly EndpointToolDescriptor[];

export interface WebToolExecutionResult {
  text: string;
  afterSend?: () => void;
}

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${key} must be a non-empty string`);
  }
  return value;
}

function requireExactKeys(args: Record<string, unknown>, keys: string[]): void {
  const actual = Object.keys(args).toSorted();
  const expected = keys.toSorted();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`arguments must contain exactly: ${expected.join(', ') || 'no fields'}`);
  }
}

export async function executeWebEndpointTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<WebToolExecutionResult> {
  if (toolName === 'web.page.get_selection') {
    requireExactKeys(args, []);
    return { text: window.getSelection()?.toString() ?? '' };
  }
  if (toolName === 'web.clipboard.write') {
    requireExactKeys(args, ['text']);
    if (!navigator.clipboard || !document.hasFocus()) {
      throw new DOMException('Clipboard access requires a focused browser tab', 'NotAllowedError');
    }
    const text = requireString(args, 'text');
    if (text.length > 100_000) throw new TypeError('text exceeds 100000 characters');
    await navigator.clipboard.writeText(text);
    return { text: 'Clipboard updated.' };
  }
  if (toolName === 'web.page.navigate') {
    requireExactKeys(args, ['url']);
    const rawUrl = requireString(args, 'url');
    if (rawUrl.length > 4_096) throw new TypeError('url exceeds 4096 characters');
    const target = new URL(rawUrl, window.location.href);
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
      throw new TypeError('url must use HTTP or HTTPS');
    }
    return {
      text: `Navigating to ${target.href}`,
      afterSend: () => window.location.assign(target.href),
    };
  }
  throw new Error(`Unknown web endpoint tool: ${toolName}`);
}
