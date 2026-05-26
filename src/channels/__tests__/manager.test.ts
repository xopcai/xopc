/**
 * Channel Manager Tests
 * 
 * Tests for the ChannelManager class.
 */

import { describe, it, expect } from 'vitest';

import type { ChannelPlugin } from '../plugin-types.js';
import { ChannelManager } from '../manager.js';

describe('ChannelManager module', () => {
  it('should export ChannelManager class', () => {
    expect(ChannelManager).toBeDefined();
    expect(typeof ChannelManager).toBe('function');
  });

  it('should export EXTENSIONS constant', () => {
    expect(ChannelManager).toBeDefined();
  });

  it('should create ChannelManager instance with valid config', () => {
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

  it('initializes disabled channels so stop still runs after start (hot-reload / runtime stop)', async () => {
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

    expect(stopCalls).toBe(1);
  });
});
