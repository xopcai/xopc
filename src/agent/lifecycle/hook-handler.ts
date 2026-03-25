/**
 * Hook Handler - Manages extension hook execution
 * 
 * Encapsulates all hook-related logic for the agent service.
 */

import type { AgentMessage } from '@mariozechner/pi-agent-core';
import type { ExtensionHookRunner } from '../../extensions/index.js';
import { createHookContext, type HookContext } from '../../extensions/index.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('HookHandler');

export interface HookHandlerDeps {
  hookRunner?: ExtensionHookRunner;
  sessionKey?: string;
  agentId: string;
}

export class HookHandler {
  constructor(private deps: HookHandlerDeps) {}

  private getContext(overrides?: Partial<HookContext>): HookContext {
    return createHookContext({
      extensionId: undefined,
      sessionKey: this.deps.sessionKey,
      agentId: this.deps.agentId,
      timestamp: new Date(),
      ...overrides,
    });
  }

  async trigger(event: string, eventData: Record<string, unknown>): Promise<void> {
    if (!this.deps.hookRunner) return;
    
    const ctx = this.getContext({ extensionId: undefined, timestamp: new Date() });
    try {
      await this.deps.hookRunner.runHooks(event as any, eventData, ctx);
    } catch (error) {
      log.warn({ event, err: error }, 'Hook execution failed');
    }
  }

  async runMessageSending(
    to: string,
    content: string,
    channel?: string,
  ): Promise<{ send: boolean; content?: string; reason?: string }> {
    if (!this.deps.hookRunner) return { send: true, content };

    const ctx = this.getContext();
    return this.deps.hookRunner.runMessageSending(to, content, ctx, channel ? { channel } : undefined);
  }

  async runMessageSent(
    to: string,
    content: string,
    success: boolean,
    error: string | undefined,
    channel?: string,
  ): Promise<void> {
    if (!this.deps.hookRunner) return;
    const ctx = this.getContext();
    await this.deps.hookRunner.runMessageSent(to, content, success, error, ctx, channel ? { channel } : undefined);
  }

  async runInputHook(
    text: string,
    images: Array<{ type: string; data: string; mimeType?: string }>,
    source: string
  ): Promise<{
    text: string;
    images: Array<{ type: string; data: string; mimeType?: string }>;
    action: 'continue' | 'handled';
    skipAgent: boolean;
    response?: string;
  }> {
    if (!this.deps.hookRunner) {
      return { text, images, action: 'continue', skipAgent: false };
    }

    const ctx = this.getContext();
    return this.deps.hookRunner.runInputHook(text, images, source, ctx);
  }

  async runContextHook(
    messages: AgentMessage[]
  ): Promise<{ messages: AgentMessage[]; modified: boolean }> {
    if (!this.deps.hookRunner) {
      return { messages, modified: false };
    }

    const ctx = this.getContext();
    const result = await this.deps.hookRunner.runContextHook(messages as any, ctx);
    return { messages: result.messages as AgentMessage[], modified: result.modified };
  }
}
