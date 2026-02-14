import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HookRunner, createHookContext, isHookEvent } from '../hooks.js';
import type { PluginRegistry, PluginHookEvent, PluginHookHandler, PluginTool } from '../types.js';

// Mock PluginRegistry
function createMockRegistry(): PluginRegistry {
  const hooks = new Map<PluginHookEvent, PluginHookHandler[]>();
  
  return {
    plugins: new Map(),
    hooks,
    channels: new Map(),
    httpRoutes: new Map(),
    commands: new Map(),
    services: new Map(),
    gatewayMethods: new Map(),
    tools: new Map(),
    getHooks(event: PluginHookEvent) {
      return hooks.get(event) || [];
    },
    getTool(name: string) {
      return this.tools.get(name);
    },
    getAllTools() {
      return Array.from(this.tools.values());
    },
    addTool(tool: PluginTool) {
      this.tools.set(tool.name, tool);
    },
    getCommand(name: string) {
      return this.commands.get(name);
    },
  } as unknown as PluginRegistry;
}

describe('HookRunner', () => {
  let registry: PluginRegistry;
  let hookRunner: HookRunner;

  beforeEach(() => {
    registry = createMockRegistry();
    hookRunner = new HookRunner(registry, {
      catchErrors: false,
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    });
  });

  describe('getRegistry()', () => {
    it('should return the plugin registry', () => {
      const result = hookRunner.getRegistry();
      expect(result).toBe(registry);
    });

    it('should allow getting hooks from registry', () => {
      // Register a test hook
      const testHandler: PluginHookHandler = vi.fn();
      registry.hooks.set('before_tool_call', [testHandler]);

      const result = hookRunner.getRegistry().getHooks('before_tool_call');
      expect(result).toHaveLength(1);
      expect(result[0]).toBe(testHandler);
    });
  });

  describe('runHooks()', () => {
    it('should execute all registered hooks for an event', async () => {
      const handler1 = vi.fn().mockResolvedValue(undefined);
      const handler2 = vi.fn().mockResolvedValue(undefined);

      registry.hooks.set('before_tool_call', [handler1, handler2]);

      await hookRunner.runHooks('before_tool_call', { toolName: 'test' }, {});

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
    });

    it('should catch errors when catchErrors is true', async () => {
      const errorHandler = vi.fn().mockRejectedValue(new Error('Test error'));
      registry.hooks.set('before_tool_call', [errorHandler]);

      // When catchErrors is true, errors are caught and logged
      const runner = new HookRunner(registry, { 
        catchErrors: true,
        logger: {
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
        }
      });
      
      const result = await runner.runHooks('before_tool_call', { toolName: 'test' }, {});

      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(1);
      expect(result.results[0]).toEqual({
        success: false,
        error: 'Test error',
      });
    });

    it('should throw when catchErrors is false', async () => {
      const errorHandler = vi.fn().mockRejectedValue(new Error('Test error'));
      registry.hooks.set('before_tool_call', [errorHandler]);

      const runner = new HookRunner(registry, { catchErrors: false });

      await expect(
        runner.runHooks('before_tool_call', { toolName: 'test' }, {})
      ).rejects.toThrow('Test error');
    });
  });

  describe('runBeforeToolCall()', () => {
    it('should allow tool execution by default', async () => {
      const result = await hookRunner.runBeforeToolCall('test_tool', { param: 'value' }, {});

      expect(result.allowed).toBe(true);
    });

    it('should block tool when hook returns block: true', async () => {
      const blockingHandler = vi.fn().mockResolvedValue({
        block: true,
        blockReason: 'Not allowed',
      });
      registry.hooks.set('before_tool_call', [blockingHandler]);

      const result = await hookRunner.runBeforeToolCall('test_tool', { param: 'value' }, {});

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('Not allowed');
    });

    it('should modify params when hook returns params', async () => {
      const modifyingHandler = vi.fn().mockResolvedValue({
        params: { modified: 'value' },
      });
      registry.hooks.set('before_tool_call', [modifyingHandler]);

      const result = await hookRunner.runBeforeToolCall('test_tool', { original: 'value' }, {});

      expect(result.params).toEqual({ modified: 'value' });
    });
  });

  describe('runMessageSending()', () => {
    it('should send message by default', async () => {
      const result = await hookRunner.runMessageSending('chat123', 'Hello', {});

      expect(result.send).toBe(true);
      expect(result.content).toBe('Hello');
    });

    it('should cancel message when hook returns cancel: true', async () => {
      const cancelHandler = vi.fn().mockResolvedValue({
        cancel: true,
        cancelReason: 'Content filtered',
      });
      registry.hooks.set('message_sending', [cancelHandler]);

      const result = await hookRunner.runMessageSending('chat123', 'Hello', {});

      expect(result.send).toBe(false);
      expect(result.reason).toBe('Content filtered');
    });

    it('should modify content when hook returns content', async () => {
      const modifyHandler = vi.fn().mockResolvedValue({
        content: 'Modified content',
      });
      registry.hooks.set('message_sending', [modifyHandler]);

      const result = await hookRunner.runMessageSending('chat123', 'Original', {});

      expect(result.content).toBe('Modified content');
    });
  });
});

describe('isHookEvent', () => {
  it('should return true for valid hook events', () => {
    expect(isHookEvent('before_agent_start')).toBe(true);
    expect(isHookEvent('message_received')).toBe(true);
    expect(isHookEvent('before_tool_call')).toBe(true);
    expect(isHookEvent('session_end')).toBe(true);
  });

  it('should return false for invalid hook events', () => {
    expect(isHookEvent('invalid_event')).toBe(false);
    expect(isHookEvent('')).toBe(false);
    expect(isHookEvent('before_invalid')).toBe(false);
  });
});
