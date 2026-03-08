/**
 * Agent Service Phase 1 Integration Test
 * 
 * Tests that Phase 1 hooks work correctly in the actual AgentService.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExtensionRegistryImpl, ExtensionHookRunner } from '../../extensions/index.js';
import type { 
  ExtensionDefinition, 
  InputHookResult,
  ContextHookResult,
  AgentMessage,
} from '../../extensions/types.js';

// Mock plugin that uses Phase 1 hooks
const _createTestPlugin = (actions: {
  onInput?: (text: string) => InputHookResult | undefined;
  onContext?: (messages: AgentMessage[]) => AgentMessage[] | undefined;
  onTurnStart?: () => void;
  onTurnEnd?: () => void;
}): ExtensionDefinition => ({
  id: 'test-phase1',
  name: 'Test Phase 1 Plugin',
  version: '1.0.0',
  
  register(api) {
    // Input hook
    if (actions.onInput) {
      api.registerHook('input', async (event): Promise<InputHookResult | void> => {
        const result = actions.onInput!(event.text);
        return result;
      });
    }

    // Context hook
    if (actions.onContext) {
      api.registerHook('context', async (event): Promise<ContextHookResult | void> => {
        const modified = actions.onContext!(event.messages);
        if (modified) {
          return { messages: modified };
        }
      });
    }

    // Turn lifecycle hooks
    if (actions.onTurnStart) {
      api.registerHook('turn_start', async () => {
        actions.onTurnStart!();
      });
    }

    if (actions.onTurnEnd) {
      api.registerHook('turn_end', async () => {
        actions.onTurnEnd!();
      });
    }
  },
});

describe('AgentService Phase 1 Integration', () => {
  let registry: ExtensionRegistryImpl;
  let hookRunner: ExtensionHookRunner;
  let _mockBus: MessageBus;

  beforeEach(() => {
    registry = new ExtensionRegistryImpl();
    hookRunner = new ExtensionHookRunner(registry, {
      catchErrors: true,
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    });

    _mockBus = {
      consumeInbound: vi.fn(),
      publishOutbound: vi.fn().mockResolvedValue(undefined),
      publishInbound: vi.fn().mockResolvedValue(undefined),
    } as unknown as MessageBus;
  });

  it('should have hookRunner with Phase 1 methods', () => {
    expect(hookRunner.runInputHook).toBeDefined();
    expect(hookRunner.runContextHook).toBeDefined();
    expect(typeof hookRunner.runInputHook).toBe('function');
    expect(typeof hookRunner.runContextHook).toBe('function');
  });

  it('should process input through runInputHook', async () => {
    const inputActions: string[] = [];

    registry.addHook(
      'input',
      async (event) => {
        inputActions.push(`input:${event.text}`);
        if (event.text === '!ping') {
          return { action: 'handled', response: 'Pong!', skipAgent: true };
        }
        return { action: 'continue' };
      },
      'test-plugin',
      0
    );

    // Simulate !ping command
    const result = await hookRunner.runInputHook('!ping', [], 'telegram', {});

    expect(result.skipAgent).toBe(true);
    expect(result.response).toBe('Pong!');
    expect(inputActions).toContain('input:!ping');
  });

  it('should transform input through runInputHook', async () => {
    registry.addHook(
      'input',
      async (event) => {
        if (event.text.startsWith('!s ')) {
          return {
            action: 'transform',
            text: `Summarize: ${event.text.slice(3)}`,
          };
        }
        return { action: 'continue' };
      },
      'test-plugin',
      0
    );

    const result = await hookRunner.runInputHook('!s long text here', [], 'telegram', {});

    expect(result.text).toBe('Summarize: long text here');
    expect(result.action).toBe('continue');
    expect(result.skipAgent).toBe(false);
  });

  it('should modify messages through runContextHook', async () => {
    registry.addHook(
      'context',
      async (event) => {
        const messages = [...event.messages];
        messages.splice(1, 0, {
          role: 'system',
          content: '[Injected]',
        } as AgentMessage);
        return { messages };
      },
      'test-plugin',
      0
    );

    const originalMessages: AgentMessage[] = [
      { role: 'system', content: 'Original' },
      { role: 'user', content: 'Hello' },
    ];

    const result = await hookRunner.runContextHook(originalMessages, {});

    expect(result.modified).toBe(true);
    expect(result.messages).toHaveLength(3);
    expect(result.messages[1].content).toBe('[Injected]');
  });

  it('should track turn lifecycle', async () => {
    const events: string[] = [];

    registry.addHook(
      'turn_start',
      async (event) => {
        events.push(`start:${event.turnIndex}`);
      },
      'test-plugin',
      0
    );

    registry.addHook(
      'turn_end',
      async (event) => {
        events.push(`end:${event.turnIndex}`);
      },
      'test-plugin',
      0
    );

    // Simulate turn
    await hookRunner.runHooks('turn_start', { turnIndex: 1, timestamp: Date.now() }, {});
    // ... LLM processing would happen here ...
    await hookRunner.runHooks('turn_end', { 
      turnIndex: 1, 
      message: { role: 'assistant', content: 'Response' },
      toolResults: [],
      timestamp: Date.now(),
    }, {});

    expect(events).toEqual(['start:1', 'end:1']);
  });

  it('should handle multiple plugins with priority', async () => {
    const order: string[] = [];

    // Plugin A with priority 10 (runs first)
    registry.addHook(
      'input',
      async () => {
        order.push('A');
        return { action: 'continue' };
      },
      'plugin-a',
      10
    );

    // Plugin B with priority 5 (runs second)
    registry.addHook(
      'input',
      async () => {
        order.push('B');
        return { action: 'continue' };
      },
      'plugin-b',
      5
    );

    // Plugin C with priority 1 (runs last)
    registry.addHook(
      'input',
      async () => {
        order.push('C');
        return { action: 'continue' };
      },
      'plugin-c',
      1
    );

    await hookRunner.runInputHook('test', [], 'telegram', {});

    expect(order).toEqual(['A', 'B', 'C']);
  });

  it('should handle content moderation workflow', async () => {
    const blockedWords = ['spam', 'scam'];

    registry.addHook(
      'input',
      async (event) => {
        const lowerText = event.text.toLowerCase();
        for (const word of blockedWords) {
          if (lowerText.includes(word)) {
            return {
              action: 'handled',
              response: `🚫 Message blocked: contains "${word}"`,
              skipAgent: true,
            };
          }
        }
        return { action: 'continue' };
      },
      'moderator',
      0
    );

    // Blocked message
    const blocked = await hookRunner.runInputHook('This is spam!', [], 'telegram', {});
    expect(blocked.skipAgent).toBe(true);
    expect(blocked.response).toContain('blocked');

    // Allowed message
    const allowed = await hookRunner.runInputHook('Hello, how are you?', [], 'telegram', {});
    expect(allowed.skipAgent).toBe(false);
  });

  it('should handle quick command workflow', async () => {
    const commands: Record<string, string> = {
      '!ping': '🏓 Pong!',
      '!help': 'Available: !ping, !help, !time',
      '!time': () => `Current time: ${new Date().toLocaleString()}`,
    };

    registry.addHook(
      'input',
      async (event) => {
        const text = event.text.trim();
        if (commands[text]) {
          const response = typeof commands[text] === 'function' 
            ? (commands[text] as Function)() 
            : commands[text];
          return {
            action: 'handled',
            response,
            skipAgent: true,
          };
        }
        return { action: 'continue' };
      },
      'commands',
      0
    );

    const pingResult = await hookRunner.runInputHook('!ping', [], 'telegram', {});
    expect(pingResult.skipAgent).toBe(true);
    expect(pingResult.response).toBe('🏓 Pong!');

    const normalResult = await hookRunner.runInputHook('Hello', [], 'telegram', {});
    expect(normalResult.skipAgent).toBe(false);
  });
});
