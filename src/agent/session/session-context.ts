/**
 * Session Context — types + an `AsyncLocalStorage`-backed manager.
 *
 * The previous implementation kept the "current" session context in a single
 * mutable field on the class. That meant bus-inbound and direct-stream paths
 * concurrently handling different sessions could overwrite each other's view
 * of "current session", with tools reading the wrong sessionKey at execution
 * time (the only thing masking it was the inbound consumer being serial).
 *
 * The new manager uses `AsyncLocalStorage`, so each async chain sees its own
 * context. Callers establish a scope via {@link SessionContextManager.runWith}
 * (preferred for `async` functions) or {@link SessionContextManager.enter}
 * (used at the top of `async function*` generators where callback-wrapping is
 * awkward; the context leaks into the rest of the current async resource by
 * design).
 */

import { AsyncLocalStorage } from 'node:async_hooks';

import type { TurnOrigin } from '@xopcai/endpoint-tools-protocol';

import type { InboundMessage } from '../../infra/bus/index.js';

export interface SessionContext {
  sessionKey: string;
  channel: string;
  chatId: string;
  senderId: string;
  isGroup: boolean;
  origin: TurnOrigin;
  model?: string;
  metadata?: Record<string, unknown>;
}

export class SessionContextManager {
  private readonly als = new AsyncLocalStorage<SessionContext>();

  /**
   * Run `fn` with `ctx` exposed via {@link getContext} for every async branch
   * it launches. The context is automatically dropped when `fn` resolves or
   * throws — there is no manual `clearContext` needed.
   */
  async runWith<T>(ctx: SessionContext, fn: () => Promise<T>): Promise<T> {
    return this.als.run(ctx, fn);
  }

  /**
   * Establish a context for the current async resource and its descendants.
   * Use this at the top of an `async function*` body where wrapping the whole
   * generator in {@link runWith} is impractical. The context leaks into the
   * rest of the current async tree by design — call from the start of an
   * isolated generator so it does not bleed across requests.
   */
  enter(ctx: SessionContext): void {
    this.als.enterWith(ctx);
  }

  /** Returns the session context for the current async chain, or null. */
  getContext(): SessionContext | null {
    return this.als.getStore() ?? null;
  }

  hasContext(): boolean {
    return this.als.getStore() !== undefined;
  }

  /** Extract session context from an inbound bus message. */
  static extractFromMessage(msg: InboundMessage): SessionContext {
    const metadata = msg.metadata || {};
    return {
      sessionKey: (metadata.sessionKey as string) || `${msg.channel}:${msg.chat_id}`,
      channel: msg.channel,
      chatId: msg.chat_id,
      senderId: (metadata.senderId as string) || '',
      isGroup: (metadata.isGroup as boolean) || false,
      origin: { type: 'channel', channel: msg.channel },
      model: metadata.model as string | undefined,
      metadata,
    };
  }

  /** Create a clone of the current context with optional overrides. */
  cloneContext(overrides?: Partial<SessionContext>): SessionContext | null {
    const current = this.getContext();
    if (!current) return null;
    return { ...current, ...overrides };
  }
}
