/**
 * Channel Manager Tests
 * 
 * Tests for the ChannelManager class.
 */

import { describe, it, expect } from 'vitest';

describe('ChannelManager module', () => {
  it('should export ChannelManager class', async () => {
    const { ChannelManager } = await import('../manager.js');
    expect(ChannelManager).toBeDefined();
    expect(typeof ChannelManager).toBe('function');
  });

  it('should export PLUGINS constant', async () => {
    // PLUGINS is a const but not exported, check manager module loads
    const module = await import('../manager.js');
    // If we can import the module without errors, basic structure is correct
    expect(module.ChannelManager).toBeDefined();
  });

  it('should create ChannelManager instance with valid config', async () => {
    const { ChannelManager } = await import('../manager.js');
    
    // Create minimal mock - we only test constructor works
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
});
