/**
 * AgentService extension hooks integration tests.
 *
 * Verifies input / context / turn lifecycle hooks on ExtensionHookRunner.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExtensionRegistryImpl, ExtensionHookRunner } from '../../extensions/index.js';
import type { AgentMessage } from '../../extensions/types.js';

describe('AgentService extension hooks integration', () => {
  let registry: ExtensionRegistryImpl;
  let hookRunner: ExtensionHookRunner;

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
  });

  it('should expose input and context hook runners', () => {
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
      'test-extension',
      0
    );

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
      'test-extension',
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
      'test-extension',
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
      'test-extension',
      0
    );

    registry.addHook(
      'turn_end',
      async (event) => {
        events.push(`end:${event.turnIndex}`);
      },
      'test-extension',
      0
    );

    await hookRunner.runHooks('turn_start', { turnIndex: 1, timestamp: Date.now() }, {});
    await hookRunner.runHooks(
      'turn_end',
      {
        turnIndex: 1,
        message: { role: 'assistant', content: 'Response' },
        toolResults: [],
        timestamp: Date.now(),
      },
      {}
    );

    expect(events).toEqual(['start:1', 'end:1']);
  });

  it('should handle multiple extensions with priority', async () => {
    const order: string[] = [];

    registry.addHook(
      'input',
      async () => {
        order.push('A');
        return { action: 'continue' };
      },
      'extension-a',
      10
    );

    registry.addHook(
      'input',
      async () => {
        order.push('B');
        return { action: 'continue' };
      },
      'extension-b',
      5
    );

    registry.addHook(
      'input',
      async () => {
        order.push('C');
        return { action: 'continue' };
      },
      'extension-c',
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

    const blocked = await hookRunner.runInputHook('This is spam!', [], 'telegram', {});
    expect(blocked.skipAgent).toBe(true);
    expect(blocked.response).toContain('blocked');

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
          const response =
            typeof commands[text] === 'function' ? (commands[text] as () => string)() : commands[text];
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
