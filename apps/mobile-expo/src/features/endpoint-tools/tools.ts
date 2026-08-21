import type { EndpointToolDescriptor } from '@xopcai/endpoint-tools-protocol';
import * as Clipboard from 'expo-clipboard';
import * as Device from 'expo-device';
import * as Linking from 'expo-linking';

export const MOBILE_ENDPOINT_TOOLS: readonly EndpointToolDescriptor[] = [
  {
    name: 'mobile.device.get_info',
    title: 'Read device information',
    description: 'Read the mobile device model and operating-system version.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    effect: 'read',
    confirmation: 'never',
    requiresForeground: false,
    requiredPermissions: [],
    timeoutMs: 10_000,
    maxConcurrency: 2,
    supportsCancellation: false,
    idempotent: true,
    resultKinds: ['text'],
  },
  {
    name: 'mobile.clipboard.write',
    title: 'Write to the clipboard',
    description: 'Replace the mobile clipboard with plain text.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['text'],
      properties: { text: { type: 'string', minLength: 1, maxLength: 100_000 } },
    },
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
    name: 'mobile.app.open_url',
    title: 'Open an external URL',
    description: 'Open an HTTP or HTTPS URL in a mobile application.',
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

export async function executeMobileEndpointTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<string> {
  if (toolName === 'mobile.device.get_info') {
    if (Object.keys(args).length !== 0) throw new TypeError('Expected no arguments');
    return JSON.stringify({
      brand: Device.brand,
      manufacturer: Device.manufacturer,
      modelName: Device.modelName,
      osName: Device.osName,
      osVersion: Device.osVersion,
    });
  }
  if (toolName === 'mobile.clipboard.write') {
    await Clipboard.setStringAsync(exactStringArgument(args, 'text', 100_000));
    return 'Clipboard updated.';
  }
  if (toolName === 'mobile.app.open_url') {
    const raw = exactStringArgument(args, 'url', 2_048);
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new TypeError('Only HTTP and HTTPS URLs are allowed');
    }
    await Linking.openURL(url.href);
    return `Opened ${url.href}`;
  }
  throw new TypeError(`Unknown mobile tool: ${toolName}`);
}
