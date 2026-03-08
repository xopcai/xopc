/**
 * Phase 1: Enhanced Hook System Tests
 * 
 * Tests for new hooks:
 * - context: Modify messages before sending to LLM
 * - input: Intercept/transform user input
 * - turn_start/turn_end: Turn-level lifecycle
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HookRunner, isHookEvent } from '../hooks.js';
import type { 
  PluginRegistry, 
  PluginHookEvent, 
  PluginHookHandler, 
  PluginTool,
  AgentMessage,
  InputHookResult,
  ContextHookResult,
  TurnStartHookEvent,
  TurnEndHookEvent,
} from '../types.js';

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

describe('Phase 1: Enhanced Hook System', () => {
  let registry: PluginRegistry;
  let hookRunner: HookRunner;

  beforeEach(() => {
    registry = createMockRegistry();
    hookRunner = new HookRunner(registry, {
      catchErrors: true,
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    });
  });

  // ============================================================================
  // Context Hook Tests
  // ============================================================================
  describe('context hook', () => {
    it('should allow plugin to modify messages before sending to LLM', async () => {
      const handler = vi.fn().mockResolvedValue({
        messages: [
          { role: 'system', content: 'Original system' },
          { role: 'system', content: 'Injected context' },
          { role: 'user', content: 'Hello' },
        ],
      } satisfies ContextHookResult);

      registry.hooks.set('context', [handler]);

      const originalMessages: AgentMessage[] = [
        { role: 'system', content: 'Original system' },
        { role: 'user', content: 'Hello' },
      ];

      const result = await hookRunner.runContextHook(originalMessages);

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ messages: expect.any(Array) }),
        expect.any(Object)
      );
      expect(result.messages).toHaveLength(3);
      expect(result.messages[1].content).toBe('Injected context');
    });

    it('should chain multiple context handlers', async () => {
      const results: string[] = [];

      const handler1 = vi.fn().mockImplementation(async (event) => {
        results.push('handler1');
        return {
          messages: [...event.messages, { role: 'assistant', content: 'A' } as AgentMessage],
        };
      });

      const handler2 = vi.fn().mockImplementation(async (event) => {
        results.push('handler2');
        return {
          messages: [...event.messages, { role: 'assistant', content: 'B' } as AgentMessage],
        };
      });

      registry.hooks.set('context', [handler1, handler2]);

      await hookRunner.runContextHook([{ role: 'user', content: 'test' }]);

      expect(results).toEqual(['handler1', 'handler2']);
      // Each handler should see the result of previous handler
      expect(handler2).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({ content: 'A' }),
          ]),
        }),
        expect.any(Object)
      );
    });

    it('should return original messages when no handlers registered', async () => {
      const originalMessages: AgentMessage[] = [
        { role: 'user', content: 'Hello' },
      ];

      const result = await hookRunner.runContextHook(originalMessages);

      expect(result.messages).toEqual(originalMessages);
    });

    it('should fallback to original messages when hook fails', async () => {
      const errorHandler = vi.fn().mockRejectedValue(new Error('Hook failed'));
      registry.hooks.set('context', [errorHandler]);

      const original: AgentMessage[] = [{ role: 'user', content: 'test' }];
      const result = await hookRunner.runContextHook(original);

      expect(result.messages).toEqual(original);
      expect(result.modified).toBe(false);
    });

    it('should filter out messages when plugin returns filtered list', async () => {
      const handler = vi.fn().mockResolvedValue({
        messages: [
          { role: 'system', content: 'Keep this' },
          { role: 'user', content: 'Keep this too' },
        ],
      });

      registry.hooks.set('context', [handler]);

      const original: AgentMessage[] = [
        { role: 'system', content: 'Keep this' },
        { role: 'user', content: 'Remove this' },
        { role: 'user', content: 'Keep this too' },
      ];

      const result = await hookRunner.runContextHook(original);

      expect(result.messages).toHaveLength(2);
      expect(result.messages.some(m => m.content === 'Remove this')).toBe(false);
    });
  });

  // ============================================================================
  // Input Hook Tests
  // ============================================================================
  describe('input hook', () => {
    it('should allow transforming user input', async () => {
      const handler = vi.fn().mockResolvedValue({
        action: 'transform',
        text: 'Modified: Hello',
      } satisfies InputHookResult);

      registry.hooks.set('input', [handler]);

      const result = await hookRunner.runInputHook('Hello', [], 'telegram');

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ text: expect.any(String), source: 'telegram' }),
        expect.any(Object)
      );
      expect(result.text).toBe('Modified: Hello');
      expect(result.action).toBe('continue');
    });

    it('should allow handling input without triggering agent', async () => {
      const handler = vi.fn().mockResolvedValue({
        action: 'handled',
        response: 'pong',
      } satisfies InputHookResult);

      registry.hooks.set('input', [handler]);

      const result = await hookRunner.runInputHook('ping', [], 'telegram');

      expect(result.action).toBe('handled');
      expect(result.skipAgent).toBe(true);
    });

    it('should block harmful content', async () => {
      const handler = vi.fn().mockImplementation(async (event) => {
        if (event.text.includes('sensitive')) {
          return {
            action: 'handled',
            response: 'Content blocked due to policy',
          } satisfies InputHookResult;
        }
        return { action: 'continue' } satisfies InputHookResult;
      });

      registry.hooks.set('input', [handler]);

      const result = await hookRunner.runInputHook('This has sensitive data', [], 'telegram');

      expect(result.action).toBe('handled');
    });

    it('should chain transformations', async () => {
      const handler1 = vi.fn().mockResolvedValue({
        action: 'transform',
        text: 'Step1: Hello',
      } satisfies InputHookResult);

      const handler2 = vi.fn().mockResolvedValue({
        action: 'transform',
        text: 'Step2: Step1: Hello',
      } satisfies InputHookResult);

      registry.hooks.set('input', [handler1, handler2]);

      const result = await hookRunner.runInputHook('Hello', [], 'telegram');

      expect(result.text).toBe('Step2: Step1: Hello');
    });

    it('should short-circuit on handled', async () => {
      const handler1 = vi.fn().mockResolvedValue({
        action: 'handled',
        response: 'Done',
      } satisfies InputHookResult);

      const handler2 = vi.fn().mockResolvedValue({
        action: 'transform',
        text: 'Should not reach',
      } satisfies InputHookResult);

      registry.hooks.set('input', [handler1, handler2]);

      const result = await hookRunner.runInputHook('Hello', [], 'telegram');

      expect(handler2).not.toHaveBeenCalled();
      expect(result.action).toBe('handled');
    });

    it('should pass through when no handlers', async () => {
      const result = await hookRunner.runInputHook('Hello', [], 'telegram');

      expect(result.text).toBe('Hello');
      expect(result.action).toBe('continue');
    });

    it('should include images in input event', async () => {
      const handler = vi.fn().mockResolvedValue({
        action: 'continue',
      } satisfies InputHookResult);

      registry.hooks.set('input', [handler]);

      const images = [{ type: 'image', data: 'base64data' }] as unknown as Array<{ type: string; data: string }>;
      await hookRunner.runInputHook('Check this image', images, 'telegram');

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          text: 'Check this image',
          images,
        }),
        expect.any(Object)
      );
    });
  });

  // ============================================================================
  // Turn Lifecycle Hooks Tests
  // ============================================================================
  describe('turn lifecycle hooks', () => {
    it('should trigger turn_start at beginning of turn', async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      registry.hooks.set('turn_start', [handler]);

      await hookRunner.runHooks('turn_start', {
        turnIndex: 1,
        timestamp: Date.now(),
      } satisfies TurnStartHookEvent, {});

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          turnIndex: 1,
          timestamp: expect.any(Number),
        }),
        expect.any(Object)
      );
    });

    it('should trigger turn_end at end of turn', async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      registry.hooks.set('turn_end', [handler]);

      const event: TurnEndHookEvent = {
        turnIndex: 1,
        message: { role: 'assistant', content: 'Response' },
        toolResults: [],
        timestamp: Date.now(),
      };

      await hookRunner.runHooks('turn_end', event, {});

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          turnIndex: 1,
          message: expect.objectContaining({ content: 'Response' }),
        }),
        expect.any(Object)
      );
    });
  });

  // ============================================================================
  // New Event Type Validation Tests
  // ============================================================================
  describe('isHookEvent with new events', () => {
    it('should recognize new hook events', () => {
      expect(isHookEvent('context')).toBe(true);
      expect(isHookEvent('input')).toBe(true);
      expect(isHookEvent('turn_start')).toBe(true);
      expect(isHookEvent('turn_end')).toBe(true);
    });

    it('should still recognize existing hook events', () => {
      expect(isHookEvent('before_agent_start')).toBe(true);
      expect(isHookEvent('message_received')).toBe(true);
      expect(isHookEvent('before_tool_call')).toBe(true);
      expect(isHookEvent('session_start')).toBe(true);
    });

    it('should reject invalid events', () => {
      expect(isHookEvent('invalid_event')).toBe(false);
      expect(isHookEvent('context_modify')).toBe(false);
      expect(isHookEvent('')).toBe(false);
    });
  });

  // ============================================================================
  // Integration Tests
  // ============================================================================
  describe('integration: multiple hook types', () => {
    it('should work with input -> context -> turn sequence', async () => {
      const sequence: string[] = [];

      registry.hooks.set('input', [
        async () => {
          sequence.push('input');
          return { action: 'continue' };
        },
      ]);

      registry.hooks.set('context', [
        async () => {
          sequence.push('context');
          return { messages: [] };
        },
      ]);

      registry.hooks.set('turn_start', [
        async () => {
          sequence.push('turn_start');
        },
      ]);

      // Simulate the flow
      await hookRunner.runInputHook('Hello', [], 'telegram');
      await hookRunner.runContextHook([]);
      await hookRunner.runHooks('turn_start', { turnIndex: 1, timestamp: Date.now() }, {});

      expect(sequence).toEqual(['input', 'context', 'turn_start']);
    });
  });
});
