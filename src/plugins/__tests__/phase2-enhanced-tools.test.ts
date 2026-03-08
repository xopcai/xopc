/**
 * Phase 2: Enhanced Tool System Tests
 *
 * Tests for:
 * - Streaming updates (onUpdate callback)
 * - State persistence (details field)
 * - Tool execution lifecycle hooks
 * - Backward compatibility
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HookRunner } from '../hooks.js';
import type {
  PluginRegistry,
  PluginHookHandler,
  PluginTool,
  EnhancedTool,
  ToolExecutionStartEvent,
  ToolExecutionUpdateEvent,
  ToolExecutionEndEvent,
  ToolResult,
  ToolUpdate,
} from '../types.js';

// Mock PluginRegistry
function createMockRegistry(): PluginRegistry {
  const hooks = new Map<string, PluginHookHandler[]>();

  return {
    plugins: new Map(),
    hooks,
    channels: new Map(),
    httpRoutes: new Map(),
    commands: new Map(),
    services: new Map(),
    gatewayMethods: new Map(),
    tools: new Map(),
    getHooks(event: string) {
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

describe('Phase 2: Enhanced Tool System', () => {
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
  // Streaming Updates Tests
  // ============================================================================
  describe('streaming updates', () => {
    it('should support onUpdate callback for progress reporting', async () => {
      const updates: Array<ToolUpdate<unknown>> = [];

      const tool: EnhancedTool = {
        name: 'long_task',
        description: 'A long running task',
        parameters: { type: 'object', properties: {} },
        async execute(toolCallId, params, signal, onUpdate) {
          onUpdate?.({ content: [{ type: 'text', text: 'Step 1/3...' }] });
          await delay(10);
          onUpdate?.({ content: [{ type: 'text', text: 'Step 2/3...' }], details: { progress: 66 } });
          await delay(10);

          return {
            content: [{ type: 'text', text: 'Task completed!' }],
            details: { stepsCompleted: 3 },
          };
        },
      };

      const result = await executeEnhancedTool(tool, {
        onUpdate: (update) => updates.push(update),
      });

      expect(updates).toHaveLength(2);
      expect(updates[0].content[0].text).toBe('Step 1/3...');
      expect(updates[1].details?.progress).toBe(66);
      expect(result.content[0].text).toBe('Task completed!');
    });

    it('should handle tools without onUpdate (backward compatible)', async () => {
      const tool: EnhancedTool = {
        name: 'simple_tool',
        description: 'Simple tool without streaming',
        parameters: { type: 'object', properties: {} },
        async execute() {
          return {
            content: [{ type: 'text', text: 'Done' }],
          };
        },
      };

      const result = await executeEnhancedTool(tool, {});

      expect(result.content[0].text).toBe('Done');
    });

    it('should handle cancellation via AbortSignal', async () => {
      const controller = new AbortController();

      const tool: EnhancedTool = {
        name: 'cancellable_task',
        description: 'Task that can be cancelled',
        parameters: { type: 'object', properties: {} },
        async execute(toolCallId, params, signal, _onUpdate) {
          for (let i = 0; i < 10; i++) {
            if (signal?.aborted) {
              return {
                content: [{ type: 'text', text: 'Cancelled by user' }],
                isError: true,
                details: { cancelledAt: i },
              };
            }
            await delay(10);
          }
          return { content: [{ type: 'text', text: 'Completed' }] };
        },
      };

      const promise = executeEnhancedTool(tool, { signal: controller.signal });
      controller.abort();

      const result = await promise;
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe('Cancelled by user');
      expect(result.details?.cancelledAt).toBeLessThan(10);
    });

    it('should stream partial results incrementally', async () => {
      const updates: string[] = [];

      const tool: EnhancedTool = {
        name: 'search',
        description: 'Search with streaming results',
        parameters: { type: 'object', properties: { query: { type: 'string' } } },
        async execute(toolCallId, params, signal, onUpdate) {
          const results = ['Result 1', 'Result 2', 'Result 3'];

          for (let i = 0; i < results.length; i++) {
            onUpdate?.({
              content: [{ type: 'text', text: `Found: ${results[i]}` }],
              details: { resultsSoFar: i + 1 },
            });
            await delay(5);
          }

          return {
            content: [{ type: 'text', text: `Found ${results.length} results` }],
            details: { totalResults: results.length, results },
          };
        },
      };

      await executeEnhancedTool(tool, {
        params: { query: 'test' },
        onUpdate: (update) => updates.push(update.content[0].text),
      });

      expect(updates).toEqual(['Found: Result 1', 'Found: Result 2', 'Found: Result 3']);
    });
  });

  // ============================================================================
  // State Persistence Tests
  // ============================================================================
  describe('state persistence', () => {
    it('should persist tool details to session', async () => {
      const tool: EnhancedTool<{ item: string }, { items: string[] }> = {
        name: 'todo',
        description: 'Add todo item',
        parameters: {
          type: 'object',
          properties: { item: { type: 'string' } },
          required: ['item'],
        },
        async execute(toolCallId, params, signal, onUpdate, ctx) {
          // In real implementation, this would load from session
          const existingItems: string[] = (ctx as any).sessionState?.todoItems || [];
          const items = [...existingItems, params.item];

          return {
            content: [{ type: 'text', text: `Added: ${params.item}` }],
            details: { items },
          };
        },
      };

      const result = await executeEnhancedTool(tool, { params: { item: 'Task 1' } });

      expect(result.details).toEqual({ items: ['Task 1'] });
    });

    it('should restore state from previous tool results', async () => {
      // Simulate previous tool results in session
      const sessionEntries = [
        { type: 'toolResult', toolName: 'todo', details: { items: ['Task 1', 'Task 2'] } },
      ];

      const tool: EnhancedTool<{ item: string }, { items: string[] }> = {
        name: 'todo',
        description: 'Add todo item',
        parameters: {
          type: 'object',
          properties: { item: { type: 'string' } },
          required: ['item'],
        },
        async execute(toolCallId, params) {
          // Restore from session (simplified)
          const prevEntry = sessionEntries.find(
            (e) => e.type === 'toolResult' && e.toolName === 'todo'
          );
          const existingItems = (prevEntry?.details as any)?.items || [];
          const items = [...existingItems, params.item];

          return {
            content: [{ type: 'text', text: `Added: ${params.item}` }],
            details: { items },
          };
        },
      };

      const result = await executeEnhancedTool(tool, { params: { item: 'Task 3' } });

      expect(result.details?.items).toEqual(['Task 1', 'Task 2', 'Task 3']);
    });

    it('should support typed details', async () => {
      interface WeatherDetails {
        location: string;
        temperature: number;
        humidity: number;
        timestamp: string;
      }

      const tool: EnhancedTool<{ city: string }, WeatherDetails> = {
        name: 'get_weather',
        description: 'Get weather for a city',
        parameters: {
          type: 'object',
          properties: { city: { type: 'string' } },
          required: ['city'],
        },
        async execute(toolCallId, params) {
          const details: WeatherDetails = {
            location: params.city,
            temperature: 25,
            humidity: 60,
            timestamp: new Date().toISOString(),
          };

          return {
            content: [{ type: 'text', text: `Weather in ${params.city}: 25°C` }],
            details,
          };
        },
      };

      const result = await executeEnhancedTool(tool, { params: { city: 'Beijing' } });

      expect(result.details?.location).toBe('Beijing');
      expect(result.details?.temperature).toBe(25);
    });
  });

  // ============================================================================
  // Tool Execution Lifecycle Hooks Tests
  // ============================================================================
  describe('tool execution lifecycle hooks', () => {
    it('should trigger tool_execution_start before execution', async () => {
      const events: string[] = [];

      registry.hooks.set('tool_execution_start', [
        async (event: ToolExecutionStartEvent) => {
          events.push(`start:${event.toolName}`);
        },
      ]);

      const tool: EnhancedTool = {
        name: 'test_tool',
        description: 'Test tool',
        parameters: { type: 'object', properties: {} },
        async execute() {
          return { content: [{ type: 'text', text: 'Done' }] };
        },
      };

      await executeEnhancedToolWithHooks(tool, hookRunner, {});

      expect(events).toContain('start:test_tool');
    });

    it('should trigger tool_execution_update during streaming', async () => {
      const updates: Array<{ toolName: string; partialResult: unknown }> = [];

      registry.hooks.set('tool_execution_update', [
        async (event: ToolExecutionUpdateEvent) => {
          updates.push({ toolName: event.toolName, partialResult: event.partialResult });
        },
      ]);

      const tool: EnhancedTool = {
        name: 'streaming_tool',
        description: 'Tool with streaming',
        parameters: { type: 'object', properties: {} },
        async execute(toolCallId, params, signal, onUpdate) {
          onUpdate?.({ content: [{ type: 'text', text: 'Progress 50%' }], details: { progress: 50 } });
          return { content: [{ type: 'text', text: 'Done' }] };
        },
      };

      await executeEnhancedToolWithHooks(tool, hookRunner, {});

      expect(updates.length).toBeGreaterThan(0);
      expect(updates[0].toolName).toBe('streaming_tool');
    });

    it('should trigger tool_execution_end after completion', async () => {
      const events: Array<{ toolName: string; success: boolean }> = [];

      registry.hooks.set('tool_execution_end', [
        async (event: ToolExecutionEndEvent) => {
          events.push({
            toolName: event.toolName,
            success: !event.isError,
          });
        },
      ]);

      const tool: EnhancedTool = {
        name: 'test_tool',
        description: 'Test tool',
        parameters: { type: 'object', properties: {} },
        async execute() {
          return { content: [{ type: 'text', text: 'Done' }] };
        },
      };

      await executeEnhancedToolWithHooks(tool, hookRunner, {});

      expect(events).toHaveLength(1);
      expect(events[0].toolName).toBe('test_tool');
      expect(events[0].success).toBe(true);
    });

    it('should trigger tool_execution_end with error status on failure', async () => {
      const events: Array<{ toolName: string; isError: boolean }> = [];

      registry.hooks.set('tool_execution_end', [
        async (event: ToolExecutionEndEvent) => {
          events.push({ toolName: event.toolName, isError: event.isError });
        },
      ]);

      const tool: EnhancedTool = {
        name: 'failing_tool',
        description: 'Tool that fails',
        parameters: { type: 'object', properties: {} },
        async execute() {
          return {
            content: [{ type: 'text', text: 'Error occurred' }],
            isError: true,
          };
        },
      };

      await executeEnhancedToolWithHooks(tool, hookRunner, {});

      expect(events[0].isError).toBe(true);
    });

    it('should include tool call ID in lifecycle events', async () => {
      const startEvents: Array<{ toolCallId: string; toolName: string }> = [];

      registry.hooks.set('tool_execution_start', [
        async (event: ToolExecutionStartEvent) => {
          startEvents.push({ toolCallId: event.toolCallId, toolName: event.toolName });
        },
      ]);

      const tool: EnhancedTool = {
        name: 'test_tool',
        description: 'Test tool',
        parameters: { type: 'object', properties: {} },
        async execute(toolCallId) {
          return { content: [{ type: 'text', text: `ID: ${toolCallId}` }] };
        },
      };

      await executeEnhancedToolWithHooks(tool, hookRunner, { toolCallId: 'call_123' });

      expect(startEvents[0].toolCallId).toBe('call_123');
    });
  });

  // ============================================================================
  // Backward Compatibility Tests
  // ============================================================================
  describe('backward compatibility', () => {
    it('should support legacy PluginTool interface', async () => {
      const legacyTool: PluginTool = {
        name: 'legacy_tool',
        description: 'Legacy tool',
        parameters: { type: 'object', properties: {} },
        async execute(params) {
          return `Result: ${JSON.stringify(params)}`;
        },
      };

      // Legacy tools should still work
      const result = await legacyTool.execute({ test: true });
      expect(result).toBe('Result: {"test":true}');
    });

    it('should allow enhanced tools to be registered alongside legacy tools', async () => {
      const legacyTool: PluginTool = {
        name: 'legacy',
        description: 'Legacy',
        parameters: { type: 'object', properties: {} },
        async execute() {
          return 'legacy result';
        },
      };

      const enhancedTool: EnhancedTool = {
        name: 'enhanced',
        description: 'Enhanced',
        parameters: { type: 'object', properties: {} },
        async execute() {
          return { content: [{ type: 'text', text: 'enhanced result' }] };
        },
      };

      registry.addTool(legacyTool);
      registry.addTool(enhancedTool as PluginTool);

      expect(registry.getTool('legacy')).toBeDefined();
      expect(registry.getTool('enhanced')).toBeDefined();
    });
  });

  // ============================================================================
  // Integration Tests
  // ============================================================================
  describe('integration: full tool lifecycle', () => {
    it('should execute full lifecycle with streaming and persistence', async () => {
      const lifecycle: string[] = [];
      const updates: Array<ToolUpdate<unknown>> = [];

      // Register lifecycle hooks
      registry.hooks.set('tool_execution_start', [
        async () => lifecycle.push('start'),
      ]);
      registry.hooks.set('tool_execution_update', [
        async () => lifecycle.push('update'),
      ]);
      registry.hooks.set('tool_execution_end', [
        async () => lifecycle.push('end'),
      ]);

      const tool: EnhancedTool = {
        name: 'full_lifecycle_tool',
        description: 'Tool demonstrating full lifecycle',
        parameters: { type: 'object', properties: {} },
        async execute(toolCallId, params, signal, onUpdate) {
          onUpdate?.({ content: [{ type: 'text', text: 'Progress 1' }] });
          onUpdate?.({ content: [{ type: 'text', text: 'Progress 2' }] });

          return {
            content: [{ type: 'text', text: 'Completed' }],
            details: { steps: 2 },
          };
        },
      };

      const result = await executeEnhancedToolWithHooks(tool, hookRunner, {
        onUpdate: (u) => updates.push(u),
      });

      expect(lifecycle).toEqual(['start', 'update', 'update', 'end']);
      expect(updates).toHaveLength(2);
      expect(result.details?.steps).toBe(2);
    });
  });
});

// ============================================================================
// Test Helpers
// ============================================================================

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface ExecuteOptions<TParams = Record<string, unknown>> {
  toolCallId?: string;
  params?: TParams;
  signal?: AbortSignal;
  onUpdate?: (update: ToolUpdate<unknown>) => void;
}

async function executeEnhancedTool<TParams, TDetails>(
  tool: EnhancedTool<TParams, TDetails>,
  options: ExecuteOptions<TParams>
): Promise<ToolResult<TDetails>> {
  const { toolCallId = 'test-call', params = {} as TParams, signal, onUpdate } = options;

  return tool.execute(toolCallId, params, signal, onUpdate, {});
}

async function executeEnhancedToolWithHooks<TParams, TDetails>(
  tool: EnhancedTool<TParams, TDetails>,
  hookRunner: HookRunner,
  options: ExecuteOptions<TParams>
): Promise<ToolResult<TDetails>> {
  const { toolCallId = 'test-call', params = {} as TParams, signal, onUpdate } = options;

  // Trigger start hook
  await hookRunner.runHooks(
    'tool_execution_start',
    {
      toolCallId,
      toolName: tool.name,
      args: params,
    } as ToolExecutionStartEvent,
    {}
  );

  // Collect updates for triggering update hooks
  const updates: Array<ToolUpdate<TDetails>> = [];

  // Wrap onUpdate to also trigger update hook
  const wrappedOnUpdate = (update: ToolUpdate<TDetails>) => {
    updates.push(update);
    // Trigger update hook
    hookRunner.runHooks(
      'tool_execution_update',
      {
        toolCallId,
        toolName: tool.name,
        args: params,
        partialResult: update,
      } as ToolExecutionUpdateEvent,
      {}
    );
    // Call original onUpdate if provided
    onUpdate?.(update);
  };

  // Execute tool
  const result = await tool.execute(toolCallId, params, signal, wrappedOnUpdate, {});

  // Trigger end hook
  await hookRunner.runHooks(
    'tool_execution_end',
    {
      toolCallId,
      toolName: tool.name,
      result: result.content,
      details: result.details,
      isError: result.isError || false,
    } as ToolExecutionEndEvent,
    {}
  );

  return result;
}
