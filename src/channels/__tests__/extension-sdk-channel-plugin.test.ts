import { describe, it, expect, vi } from 'vitest';
import {
  ExtensionSdkChannelPlugin,
  isSdkChannelExtension,
} from '../extension-sdk-channel-plugin.js';

describe('isSdkChannelExtension', () => {
  it('accepts minimal SDK shape', () => {
    expect(
      isSdkChannelExtension({
        name: 'test',
        connect: async () => {},
        disconnect: async () => {},
        sendMessage: async () => {},
      }),
    ).toBe(true);
  });

  it('rejects incomplete objects', () => {
    expect(isSdkChannelExtension({ name: 'x' })).toBe(false);
    expect(isSdkChannelExtension(null)).toBe(false);
  });
});

describe('ExtensionSdkChannelPlugin', () => {
  it('implements extensionManagedConfig', () => {
    const sdk = {
      name: 'demo',
      connect: vi.fn(async () => {}),
      disconnect: vi.fn(async () => {}),
      sendMessage: vi.fn(async () => {}),
    };
    const p = new ExtensionSdkChannelPlugin(sdk);
    expect(p.extensionManagedConfig).toBe(true);
    expect(p.id).toBe('demo');
  });
});
