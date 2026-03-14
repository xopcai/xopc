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
});
