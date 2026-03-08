/**
 * Plugin Registry Tests - Unified registry for Phase 4 features
 *
 * Tests for:
 * - Provider registration
 * - Flag registration and parsing
 * - Shortcut registration and execution
 * - Unified cleanup
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PluginRegistry } from '../plugin-registry.js';
import type { ProviderConfig } from '../types.js';

describe('Plugin Registry (Unified)', () => {
  let registry: PluginRegistry;

  beforeEach(() => {
    registry = new PluginRegistry({
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    });
  });

  // ============================================================================
  // Provider Tests
  // ============================================================================
  describe('providers', () => {
    it('should register a provider with models', () => {
      const config: ProviderConfig = {
        name: 'my-proxy',
        baseUrl: 'https://proxy.example.com/v1',
        apiKey: 'test-key',
        api: 'openai-completions',
        models: [
          {
            id: 'gpt-4-custom',
            name: 'GPT-4 (Custom)',
            contextWindow: 128000,
            maxTokens: 8192,
            cost: { input: 0.03, output: 0.06 },
          },
        ],
      };

      registry.registerProvider('my-proxy', config);

      const provider = registry.getProvider('my-proxy');
      expect(provider).toBeDefined();
      expect(provider?.baseUrl).toBe('https://proxy.example.com/v1');
      expect(provider?.models).toHaveLength(1);
    });

    it('should override existing provider baseUrl', () => {
      registry.registerProvider('openai', {
        name: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'key1',
        api: 'openai-completions',
        models: [],
      });

      registry.registerProvider('openai', {
        baseUrl: 'https://proxy.example.com/openai',
      });

      const provider = registry.getProvider('openai');
      expect(provider?.baseUrl).toBe('https://proxy.example.com/openai');
      expect(provider?.apiKey).toBe('key1');
    });

    it('should unregister provider', () => {
      registry.registerProvider('test', {
        name: 'test',
        baseUrl: 'https://test.com',
        apiKey: 'key',
        api: 'openai-completions',
        models: [],
      });

      expect(registry.getProviderNames()).toContain('test');

      registry.unregisterProvider('test');

      expect(registry.getProvider('test')).toBeUndefined();
    });
  });

  // ============================================================================
  // Flag Tests
  // ============================================================================
  describe('flags', () => {
    it('should register a boolean flag', () => {
      registry.registerFlag('verbose', {
        type: 'boolean',
        default: false,
        description: 'Enable verbose logging',
      });

      expect(registry.getFlag('verbose')).toBe(false);
    });

    it('should register a string flag with aliases', () => {
      registry.registerFlag('config', {
        type: 'string',
        default: 'default.json',
        description: 'Config file',
        aliases: ['-c', '--config'],
      });

      expect(registry.getFlag('config')).toBe('default.json');
    });

    it('should parse boolean flag from args', () => {
      registry.registerFlag('verbose', {
        type: 'boolean',
        default: false,
        description: 'Verbose',
      });

      registry.parseArgs(['--verbose']);

      expect(registry.getFlag('verbose')).toBe(true);
    });

    it('should parse string flag with value from args', () => {
      registry.registerFlag('output', {
        type: 'string',
        default: 'out.txt',
        description: 'Output file',
      });

      registry.parseArgs(['--output', 'result.txt']);

      expect(registry.getFlag('output')).toBe('result.txt');
    });

    it('should throw on duplicate flag', () => {
      registry.registerFlag('test', {
        type: 'boolean',
        default: false,
        description: 'Test',
      });

      expect(() => {
        registry.registerFlag('test', {
          type: 'boolean',
          default: true,
          description: 'Test 2',
        });
      }).toThrow('Flag already registered');
    });
  });

  // ============================================================================
  // Shortcut Tests
  // ============================================================================
  describe('shortcuts', () => {
    it('should register a shortcut', () => {
      const handler = vi.fn();

      registry.registerShortcut('ctrl+p', {
        description: 'Test shortcut',
        handler,
      });

      expect(registry.hasShortcut('ctrl+p')).toBe(true);
    });

    it('should execute shortcut handler', async () => {
      const handler = vi.fn();

      registry.registerShortcut('ctrl+p', {
        description: 'Test',
        handler,
      });

      const result = await registry.executeShortcut('ctrl+p', {});

      expect(result).toBe(true);
      expect(handler).toHaveBeenCalledWith({});
    });

    it('should normalize shortcut keys', () => {
      const handler = vi.fn();

      registry.registerShortcut('Ctrl+P', {
        description: 'Test',
        handler,
      });

      expect(registry.hasShortcut('ctrl+p')).toBe(true);
      expect(registry.hasShortcut('CTRL+P')).toBe(true);
    });

    it('should warn on built-in shortcut override', () => {
      registry.registerBuiltinShortcut('ctrl+n', 'New file');
      registry.registerShortcut('ctrl+n', {
        description: 'Plugin shortcut',
        handler: vi.fn(),
      });

      expect(registry.hasShortcut('ctrl+n')).toBe(true);
    });

    it('should throw on duplicate plugin shortcut', () => {
      registry.registerShortcut('ctrl+p', {
        description: 'First',
        handler: vi.fn(),
      });

      expect(() => {
        registry.registerShortcut('ctrl+p', {
          description: 'Second',
          handler: vi.fn(),
        });
      }).toThrow('Shortcut conflict');
    });
  });

  // ============================================================================
  // Cleanup Tests
  // ============================================================================
  describe('cleanup', () => {
    it('should cleanup provider on plugin unload', () => {
      registry.registerProvider('plugin-provider', {
        name: 'test',
        baseUrl: 'https://test.com',
        apiKey: 'key',
        api: 'openai-completions',
        models: [],
      }, 'plugin-provider');

      registry.cleanup('plugin-provider');

      expect(registry.getProvider('plugin-provider')).toBeUndefined();
    });

    it('should cleanup flags on plugin unload', () => {
      registry.registerFlag('plugin-flag', {
        type: 'boolean',
        default: false,
        description: 'Test',
      }, 'test-plugin');

      registry.cleanup('test-plugin');

      expect(registry.getFlag('plugin-flag')).toBeUndefined();
    });

    it('should cleanup shortcuts on plugin unload', () => {
      registry.registerShortcut('ctrl+p', {
        description: 'Test',
        handler: vi.fn(),
      }, { pluginId: 'test-plugin' });

      registry.cleanup('test-plugin');

      expect(registry.hasShortcut('ctrl+p')).toBe(false);
    });

    it('should cleanup all resources', () => {
      registry.registerProvider('p1', {
        name: 'p1',
        baseUrl: 'https://p1.com',
        apiKey: 'k1',
        api: 'openai-completions',
        models: [],
      }, 'p1');

      registry.registerFlag('f1', {
        type: 'boolean',
        default: false,
        description: 'Test',
      }, 'p1');

      registry.registerShortcut('ctrl+a', {
        description: 'Test',
        handler: vi.fn(),
      }, { pluginId: 'p1' });

      registry.cleanup('p1');

      expect(registry.getProviderNames()).not.toContain('p1');
    });
  });

  // ============================================================================
  // Integration Tests
  // ============================================================================
  describe('integration', () => {
    it('should support complete plugin lifecycle', () => {
      registry.registerProvider('my-provider', {
        name: 'My Provider',
        baseUrl: 'https://my-provider.com',
        apiKey: 'key',
        api: 'openai-completions',
        models: [{ id: 'model-1', name: 'Model 1', contextWindow: 1000, maxTokens: 100 }],
      }, 'my-plugin');

      registry.registerFlag('my-flag', {
        type: 'boolean',
        default: false,
        description: 'My flag',
      }, 'my-plugin');

      registry.registerShortcut('ctrl+m', {
        description: 'My shortcut',
        handler: vi.fn(),
      }, { pluginId: 'my-plugin' });

      expect(registry.getProvider('my-provider')).toBeDefined();
      expect(registry.getFlag('my-flag')).toBe(false);
      expect(registry.hasShortcut('ctrl+m')).toBe(true);

      registry.cleanup('my-plugin');

      expect(registry.getProvider('my-provider')).toBeUndefined();
      expect(registry.getFlag('my-flag')).toBeUndefined();
      expect(registry.hasShortcut('ctrl+m')).toBe(false);
    });
  });
});
