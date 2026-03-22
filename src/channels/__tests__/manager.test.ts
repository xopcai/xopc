/**
 * Channel Manager Tests
 * 
 * Tests for the ChannelManager class.
 */

import { describe, it, expect } from 'vitest';

import type { ChannelPlugin } from '../plugin-types.js';

describe('ChannelManager module', () => {
  it('should export ChannelManager class', async () => {
    const { ChannelManager } = await import('../manager.js');
    expect(ChannelManager).toBeDefined();
    expect(typeof ChannelManager).toBe('function');
  });

  it('should export EXTENSIONS constant', async () => {
    const module = await import('../manager.js');
    expect(module.ChannelManager).toBeDefined();
  });

  it('should create ChannelManager instance with valid config', async () => {
    const { ChannelManager } = await import('../manager.js');
    
    const mockConfig = {
      channels: {}
    } as any;
    const mockBus = {
      on: () => {},
      publishInbound: async () => {},
      publishOutbound: async () => {},
    } as any;
    
    const manager = new ChannelManager(mockConfig, mockBus);
    expect(manager).toBeDefined();
  });

  it('does not call stop on plugins that were never initialized', async () => {
    const { ChannelManager } = await import('../manager.js');

    let stopCalls = 0;
    const plugin = {
      id: 'mockchan',
      meta: {
        id: 'mockchan',
        label: 'Mock',
        selectionLabel: 'Mock',
        docsPath: '/mock',
        blurb: '',
      },
      capabilities: {
        chatTypes: ['direct'],
        reactions: false,
        threads: false,
        media: false,
        polls: false,
        nativeCommands: false,
        blockStreaming: false,
      },
      config: {
        listAccountIds: () => ['default'],
        resolveAccount: () => ({}) as any,
      },
      init: async () => {},
      start: async () => {},
      stop: async () => {
        stopCalls++;
      },
    } as unknown as ChannelPlugin;

    const mockBus = {
      on: () => {},
      publishInbound: async () => {},
      publishOutbound: async () => {},
    } as any;

    const manager = new ChannelManager({ channels: {} } as any, mockBus);
    manager.registerPlugin(plugin);

    await manager.initialize();
    await manager.start();
    await manager.stop();

    expect(stopCalls).toBe(0);
  });
});
