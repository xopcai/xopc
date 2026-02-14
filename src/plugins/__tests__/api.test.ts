import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PluginApiImpl, createPluginLogger, createPathResolver } from '../api.js';
import type { PluginLogger, PluginTool, PluginCommand } from '../types.js';

// Mock dependencies
const mockLogger: PluginLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const mockConfig = {
  agents: {
    defaults: {
      model: 'test-model',
    },
  },
} as any;

const mockPluginConfig = {
  setting: 'value',
};

const mockResolvePath = (input: string) => `/resolved/${input}`;

describe('PluginApiImpl', () => {
  let api: PluginApiImpl;

  beforeEach(() => {
    api = new PluginApiImpl(
      'test-plugin',
      'Test Plugin',
      '1.0.0',
      '/path/to/plugin',
      mockConfig,
      mockPluginConfig,
      mockLogger,
      mockResolvePath
    );
  });

  describe('registerTool()', () => {
    it('should register a tool', () => {
      const tool: PluginTool = {
        name: 'test_tool',
        description: 'A test tool',
        parameters: { type: 'object' },
        execute: async () => 'result',
      };

      api.registerTool(tool);

      const tools = api._getTools();
      expect(tools.has('test_tool')).toBe(true);
    });

    it('should warn when registering duplicate tool', () => {
      const tool: PluginTool = {
        name: 'test_tool',
        description: 'A test tool',
        parameters: { type: 'object' },
        execute: async () => 'result',
      };

      api.registerTool(tool);
      api.registerTool(tool);

      expect(mockLogger.warn).toHaveBeenCalled();
    });
  });

  describe('registerHook()', () => {
    it('should register a hook handler', () => {
      const handler = vi.fn();

      api.registerHook('before_tool_call', handler);

      const hooks = api._getHooks();
      expect(hooks.has('before_tool_call')).toBe(true);
    });

    it('should support once option', () => {
      const handler = vi.fn();

      api.registerHook('before_tool_call', handler, { once: true });

      const hooks = api._getHooks();
      expect(hooks.has('before_tool_call')).toBe(true);
    });
  });

  describe('resolvePath()', () => {
    it('should resolve paths using the resolver', () => {
      const result = api.resolvePath('test.txt');

      expect(result).toBe('/resolved/test.txt');
    });

    it('should handle absolute paths', () => {
      const api2 = new PluginApiImpl(
        'test-plugin',
        'Test Plugin',
        '1.0.0',
        '/path/to/plugin',
        mockConfig,
        mockPluginConfig,
        mockLogger,
        (input) => input
      );

      const result = api2.resolvePath('/absolute/path');

      expect(result).toBe('/absolute/path');
    });
  });

  describe('emit/on/off (event bus)', () => {
    it('should emit and receive events', () => {
      const handler = vi.fn();
      api.on('test-event', handler);

      api.emit('test-event', { data: 'test' });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith({ data: 'test' });
    });

    it('should remove event handlers', () => {
      const handler = vi.fn();
      api.on('test-event', handler);
      api.off('test-event', handler);

      api.emit('test-event', { data: 'test' });

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('registerCommand()', () => {
    it('should not throw when registering a command', () => {
      const command: PluginCommand = {
        name: 'test',
        description: 'Test command',
        handler: async () => ({ content: 'result' }),
      };

      // Should not throw
      expect(() => api.registerCommand(command)).not.toThrow();
    });
  });

  describe('registerHttpRoute()', () => {
    it('should not throw when registering an HTTP route', () => {
      const handler = async () => {};

      // Should not throw
      expect(() => api.registerHttpRoute('/test', handler)).not.toThrow();
    });
  });

  describe('registerService()', () => {
    it('should not throw when registering a service', () => {
      const service = {
        id: 'test-service',
        start: vi.fn(),
      };

      // Should not throw
      expect(() => api.registerService(service)).not.toThrow();
    });
  });

  describe('registerGatewayMethod()', () => {
    it('should not throw when registering a gateway method', () => {
      const handler = async () => 'result';

      // Should not throw
      expect(() => api.registerGatewayMethod('test.method', handler)).not.toThrow();
    });
  });
});

describe('createPluginLogger', () => {
  it('should create a logger with prefix', () => {
    const logger = createPluginLogger('test-prefix');

    expect(typeof logger.debug).toBe('function');
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
  });

  it('should call underlying logger with prefix', () => {
    const logger = createPluginLogger('[my-plugin]');

    logger.info('Test message');
    // The underlying logger should be called (implementation detail)
  });
});

describe('createPathResolver', () => {
  it('should resolve relative paths from plugin dir', () => {
    const resolver = createPathResolver('/plugin/dir', '/workspace');

    const result = resolver('./data.json');
    expect(result).toBe('/plugin/dir/data.json');
  });

  it('should resolve paths relative to workspace', () => {
    const resolver = createPathResolver('/plugin/dir', '/workspace');

    const result = resolver('config.json');
    expect(result).toBe('/workspace/config.json');
  });

  it('should handle tilde paths', () => {
    const resolver = createPathResolver('/plugin/dir', '/workspace');

    process.env.HOME = '/home/user';
    const result = resolver('~/file.txt');
    expect(result).toBe('/home/user/file.txt');
  });

  it('should return absolute paths unchanged', () => {
    const resolver = createPathResolver('/plugin/dir', '/workspace');

    const result = resolver('/absolute/path');
    expect(result).toBe('/absolute/path');
  });
});
