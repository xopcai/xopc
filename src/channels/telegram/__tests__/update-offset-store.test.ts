/**
 * Update Offset Store Tests
 * 
 * Tests for the offset store utilities.
 * These tests verify the module structure and exported functions.
 */

import { describe, it, expect } from 'vitest';

describe('Update Offset Store exports', () => {
  it('should export required functions', async () => {
    const module = await import('../update-offset-store.js');
    
    // Check exports exist
    expect(typeof module.readUpdateOffset).toBe('function');
    expect(typeof module.writeUpdateOffset).toBe('function');
    expect(typeof module.clearUpdateOffset).toBe('function');
    expect(typeof module.getAllOffsets).toBe('function');
    expect(typeof module.offsetStoreCache).toBe('object');
  });

  it('should export OffsetStoreCache class', async () => {
    const { offsetStoreCache } = await import('../update-offset-store.js');
    
    // Check cache methods exist
    expect(typeof offsetStoreCache.get).toBe('function');
    expect(typeof offsetStoreCache.set).toBe('function');
    expect(typeof offsetStoreCache.flush).toBe('function');
  });
});

describe('OffsetStoreCache methods', () => {
  it('should have get, set, and flush methods', async () => {
    const { offsetStoreCache } = await import('../update-offset-store.js');
    
    expect(offsetStoreCache).toBeDefined();
    expect(typeof offsetStoreCache.get).toBe('function');
    expect(typeof offsetStoreCache.set).toBe('function');
    expect(typeof offsetStoreCache.flush).toBe('function');
  });
});
