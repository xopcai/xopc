import { describe, it, expect, beforeEach } from 'vitest';
import { PluginLoader, normalizePluginConfig } from '../loader.js';

describe('PluginLoader', () => {
  describe('normalizePluginConfig()', () => {
    it('should normalize enabled plugins', () => {
      const config = {
        enabled: ['plugin-a', 'plugin-b'],
        'plugin-a': { setting: 'value' },
      };

      const result = normalizePluginConfig(config);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: 'plugin-a',
        origin: 'config',
        path: 'plugin-a',
        enabled: true,
        config: { setting: 'value' },
      });
      expect(result[1]).toEqual({
        id: 'plugin-b',
        origin: 'config',
        path: 'plugin-b',
        enabled: true,
        config: {},
      });
    });

    it('should handle disabled plugins', () => {
      const config = {
        enabled: ['plugin-a'],
        disabled: ['plugin-b'],
      };

      const result = normalizePluginConfig(config);

      expect(result).toHaveLength(2);
      expect(result[0].enabled).toBe(true);
      expect(result[1].enabled).toBe(false);
    });

    it('should handle boolean plugin config', () => {
      const config = {
        enabled: ['plugin-a', 'plugin-b'],
        'plugin-a': true,
        'plugin-b': { setting: 'value' },
      };

      const result = normalizePluginConfig(config);

      expect(result[0].config).toBe(true);
      expect(result[1].config).toEqual({ setting: 'value' });
    });

    it('should handle empty config', () => {
      const result = normalizePluginConfig({});

      expect(result).toHaveLength(0);
    });
  });

  describe('getRegistry()', () => {
    let loader: PluginLoader;

    beforeEach(() => {
      loader = new PluginLoader({
        workspaceDir: '/tmp/workspace',
        pluginsDir: '/tmp/workspace/.plugins',
      });
    });

    it('should return a PluginRegistry', () => {
      const registry = loader.getRegistry();

      expect(registry).toBeDefined();
      expect(typeof registry.addTool).toBe('function');
      expect(typeof registry.getTool).toBe('function');
      expect(typeof registry.getAllTools).toBe('function');
    });

    it('should allow adding and retrieving tools', () => {
      const registry = loader.getRegistry();

      const tool = {
        name: 'test_tool',
        description: 'A test tool',
        parameters: { type: 'object' },
        execute: async () => 'result',
      };

      registry.addTool(tool);

      expect(registry.getTool('test_tool')).toEqual(tool);
      expect(registry.getAllTools()).toHaveLength(1);
    });
  });
});

describe('PluginRegistry (via PluginLoader)', () => {
  let loader: PluginLoader;

  beforeEach(() => {
    loader = new PluginLoader();
  });

  describe('getCommand()', () => {
    it('should return undefined for non-existent command', () => {
      const registry = loader.getRegistry();
      const command = registry.getCommand('non_existent');

      expect(command).toBeUndefined();
    });

    it('should store and retrieve commands', () => {
      const registry = loader.getRegistry();

      const command = {
        name: 'test',
        description: 'Test command',
        handler: async () => ({ content: 'result' }),
      };

      registry.commands.set('test', command);

      expect(registry.getCommand('test')).toEqual(command);
    });
  });

  describe('httpRoutes', () => {
    it('should store and retrieve HTTP routes', () => {
      const registry = loader.getRegistry();

      const handler = async () => {};
      registry.httpRoutes.set('/test', handler);

      expect(registry.httpRoutes.get('/test')).toBe(handler);
    });
  });

  describe('gatewayMethods', () => {
    it('should store and retrieve gateway methods', () => {
      const registry = loader.getRegistry();

      const handler = async () => 'result';
      registry.gatewayMethods.set('test.method', handler);

      expect(registry.gatewayMethods.get('test.method')).toBe(handler);
    });
  });
});
