import type { EndpointToolDescriptor } from '@xopcai/endpoint-tools-protocol';

import type { EndpointToolExecutionResult } from './host';

const textArgumentSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['text'],
  properties: { text: { type: 'string', minLength: 1, maxLength: 100_000 } },
};

export const DESKTOP_ENDPOINT_TOOLS: readonly EndpointToolDescriptor[] = [
  {
    name: 'desktop.clipboard.read',
    title: 'Read the clipboard',
    description: 'Read plain text from the desktop clipboard.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    effect: 'read',
    confirmation: 'always',
    requiresForeground: true,
    requiredPermissions: ['clipboard-read'],
    timeoutMs: 10_000,
    maxConcurrency: 1,
    supportsCancellation: false,
    idempotent: true,
    resultKinds: ['text'],
  },
  {
    name: 'desktop.clipboard.write',
    title: 'Write to the clipboard',
    description: 'Replace the desktop clipboard with plain text.',
    inputSchema: textArgumentSchema,
    effect: 'write',
    confirmation: 'always',
    requiresForeground: true,
    requiredPermissions: ['clipboard-write'],
    timeoutMs: 10_000,
    maxConcurrency: 1,
    supportsCancellation: false,
    idempotent: true,
    resultKinds: ['text'],
  },
  {
    name: 'desktop.app.open_external',
    title: 'Open an external URL',
    description: 'Open an HTTP or HTTPS URL in the default desktop application.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['url'],
      properties: { url: { type: 'string', minLength: 1, maxLength: 2_048 } },
    },
    effect: 'write',
    confirmation: 'always',
    requiresForeground: true,
    requiredPermissions: ['open-external-url'],
    timeoutMs: 15_000,
    maxConcurrency: 1,
    supportsCancellation: false,
    idempotent: false,
    resultKinds: ['text'],
  },
];

function exactStringArgument(
  args: Record<string, unknown>,
  name: string,
  maxLength: number,
): string {
  if (Object.keys(args).length !== 1 || typeof args[name] !== 'string') {
    throw new TypeError(`Expected exactly one string argument: ${name}`);
  }
  const value = args[name];
  if (!value || value.length > maxLength) throw new TypeError(`Invalid ${name}`);
  return value;
}

export async function executeDesktopEndpointTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<EndpointToolExecutionResult> {
  const api = window.electronAPI;
  if (!api) throw new Error('Desktop bridge is unavailable');

  if (toolName === 'desktop.clipboard.read') {
    if (Object.keys(args).length !== 0) throw new TypeError('Expected no arguments');
    if (!api.clipboard?.readText) throw new Error('Clipboard read is unavailable');
    return { text: await api.clipboard.readText() };
  }
  if (toolName === 'desktop.clipboard.write') {
    const text = exactStringArgument(args, 'text', 100_000);
    if (!api.clipboard?.writeText || !(await api.clipboard.writeText(text))) {
      throw new Error('Clipboard write failed');
    }
    return { text: 'Clipboard updated.' };
  }
  if (toolName === 'desktop.app.open_external') {
    const raw = exactStringArgument(args, 'url', 2_048);
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new TypeError('Only HTTP and HTTPS URLs are allowed');
    }
    if (!api.shell?.openExternalUrl) throw new Error('External URL opening is unavailable');
    const result = await api.shell.openExternalUrl(url.href);
    if (!result.ok) throw new Error(result.error);
    return { text: `Opened ${url.href}` };
  }
  throw new TypeError(`Unknown desktop tool: ${toolName}`);
}
