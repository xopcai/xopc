/**
 * Phase 1 Integration Test
 * 
 * Verifies that enhanced hooks work in the actual Agent flow.
 * This test simulates the message processing pipeline.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HookRunner } from '../hooks.js';
import type { 
  PluginRegistry, 
  PluginHookHandler,
  PluginTool,
  AgentMessage,
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

/**
 * Simulates the Agent message processing flow with Phase 1 hooks
 */
async function simulateAgentFlow(
  hookRunner: HookRunner,
  userInput: string,
  source: string = 'telegram'
): Promise<{
  processed: boolean;
  messages: AgentMessage[];
  response?: string;
}> {
  // Step 1: Input hook processing
  const inputResult = await hookRunner.runInputHook(userInput, [], source);
  
  // If handled by input hook, return early
  if (inputResult.skipAgent) {
    return {
      processed: false,
      messages: [],
      response: inputResult.response,
    };
  }

  // Step 2: Build message context
  const messages: AgentMessage[] = [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: inputResult.text },
  ];

  // Step 3: Context hook - modify before sending to LLM
  const contextResult = await hookRunner.runContextHook(messages);

  // Step 4: Turn start
  await hookRunner.runHooks('turn_start', {
    turnIndex: 1,
    timestamp: Date.now(),
  }, {});

  // Step 5: Simulate LLM response (in real flow, this would call the LLM)
  const assistantMessage: AgentMessage = {
    role: 'assistant',
    content: `Response to: ${contextResult.messages[contextResult.messages.length - 1]?.content}`,
  };

  // Step 6: Turn end
  await hookRunner.runHooks('turn_end', {
    turnIndex: 1,
    message: assistantMessage,
    toolResults: [],
    timestamp: Date.now(),
  }, {});

  return {
    processed: true,
    messages: contextResult.messages,
  };
}

describe('Phase 1: Agent Flow Integration', () => {
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

  it('should handle quick commands without calling LLM', async () => {
    // Plugin registers input hook for quick commands
    registry.hooks.set('input', [
      async (event) => {
        if (event.text === '!ping') {
          return {
            action: 'handled',
            response: 'Pong!',
          };
        }
        return { action: 'continue' };
      },
    ]);

    const result = await simulateAgentFlow(hookRunner, '!ping');

    expect(result.processed).toBe(false);
    expect(result.response).toBe('Pong!');
  });

  it('should inject context before LLM call', async () => {
    // Plugin registers context hook
    registry.hooks.set('context', [
      async (event) => {
        const messages = [...event.messages];
        // Inject after first system message
        messages.splice(1, 0, {
          role: 'system',
          content: '[Injected] Always respond in Chinese.',
        });
        return { messages };
      },
    ]);

    const result = await simulateAgentFlow(hookRunner, 'Hello');

    expect(result.processed).toBe(true);
    expect(result.messages).toHaveLength(3);
    expect(result.messages[1].content).toContain('[Injected]');
  });

  it('should track turns with lifecycle hooks', async () => {
    const events: string[] = [];

    registry.hooks.set('turn_start', [
      async () => {
        events.push('turn_start');
      },
    ]);

    registry.hooks.set('turn_end', [
      async () => {
        events.push('turn_end');
      },
    ]);

    await simulateAgentFlow(hookRunner, 'Hello');

    expect(events).toEqual(['turn_start', 'turn_end']);
  });

  it('should transform input before processing', async () => {
    registry.hooks.set('input', [
      async (event) => {
        // Auto-expand shorthand
        if (event.text.startsWith('!s ')) {
          return {
            action: 'transform',
            text: `Summarize this: ${event.text.slice(3)}`,
          };
        }
        return { action: 'continue' };
      },
    ]);

    const result = await simulateAgentFlow(hookRunner, '!s long text here');

    expect(result.processed).toBe(true);
    // The transformed text should be in the messages
    const userMessage = result.messages.find(m => m.role === 'user');
    expect(userMessage?.content).toBe('Summarize this: long text here');
  });

  it('should handle multiple plugins with chain of hooks', async () => {
    const executionOrder: string[] = [];

    // Plugin A: Input transformation
    registry.hooks.set('input', [
      async (_event) => {
        executionOrder.push('input:A');
        return { action: 'continue' };
      },
    ]);

    // Plugin B: Context injection
    registry.hooks.set('context', [
      async (event) => {
        executionOrder.push('context:B');
        return { messages: event.messages };
      },
    ]);

    // Plugin C: Turn tracking
    registry.hooks.set('turn_start', [
      async () => {
        executionOrder.push('turn_start:C');
      },
    ]);

    registry.hooks.set('turn_end', [
      async () => {
        executionOrder.push('turn_end:C');
      },
    ]);

    await simulateAgentFlow(hookRunner, 'Hello');

    expect(executionOrder).toEqual([
      'input:A',
      'context:B',
      'turn_start:C',
      'turn_end:C',
    ]);
  });

  it('should continue processing even if one hook fails', async () => {
    registry.hooks.set('context', [
      async () => {
        throw new Error('Hook failed');
      },
    ]);

    registry.hooks.set('turn_start', [
      async () => {
        // This should still be called
      },
    ]);

    // Should not throw
    const result = await simulateAgentFlow(hookRunner, 'Hello');

    expect(result.processed).toBe(true);
    // Original messages should be used when context hook fails
    expect(result.messages).toHaveLength(2);
  });

  it('should handle content moderation in input hook', async () => {
    registry.hooks.set('input', [
      async (event) => {
        if (event.text.includes('spam')) {
          return {
            action: 'handled',
            response: 'Message blocked.',
          };
        }
        return { action: 'continue' };
      },
    ]);

    const result = await simulateAgentFlow(hookRunner, 'This is spam!');

    expect(result.processed).toBe(false);
    expect(result.response).toBe('Message blocked.');
  });
});
