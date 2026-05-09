import type { AgentTool } from '@earendil-works/pi-agent-core';

import { createLogger } from '../../utils/logger.js';
import type { MemoryProvider, MemoryProviderInitOptions } from './provider.js';

const log = createLogger('MemoryManager');

export class MemoryManager {
  private providers: MemoryProvider[] = [];
  private toolToProvider = new Map<string, MemoryProvider>();
  private hasExternal = false;

  addProvider(provider: MemoryProvider): void {
    const isBuiltin = provider.name === 'builtin';

    if (!isBuiltin) {
      if (this.hasExternal) {
        const existing = this.providers.find((p) => p.name !== 'builtin')?.name ?? 'unknown';
        log.warn(
          { rejected: provider.name, existing },
          'Rejected memory provider — only one external provider allowed',
        );
        return;
      }
      this.hasExternal = true;
    }

    this.providers.push(provider);

    for (const schema of provider.getToolSchemas()) {
      const toolName = schema.name;
      if (!toolName) {
        continue;
      }
      if (!this.toolToProvider.has(toolName)) {
        this.toolToProvider.set(toolName, provider);
      } else {
        log.warn(
          { toolName, existing: this.toolToProvider.get(toolName)?.name, ignored: provider.name },
          'Memory tool name conflict',
        );
      }
    }

    log.info({ name: provider.name, toolCount: provider.getToolSchemas().length }, 'Memory provider registered');
  }

  get providersList(): MemoryProvider[] {
    return [...this.providers];
  }

  /**
   * Non-builtin static instructions (builtin uses curated snapshot in system prompt builder).
   */
  buildExternalSystemPrompt(): string {
    const blocks: string[] = [];
    for (const p of this.providers) {
      if (p.name === 'builtin') {
        continue;
      }
      try {
        const block = p.systemPromptBlock();
        if (block?.trim()) {
          blocks.push(block.trim());
        }
      } catch (err) {
        log.warn({ err, name: p.name }, 'systemPromptBlock failed');
      }
    }
    return blocks.join('\n\n');
  }

  async prefetchAll(query: string, options?: { sessionId?: string }): Promise<string> {
    const parts: string[] = [];
    for (const p of this.providers) {
      try {
        const v = await p.prefetch(query, options);
        if (v?.trim()) {
          parts.push(v.trim());
        }
      } catch (err) {
        log.debug({ err, name: p.name }, 'prefetch failed (non-fatal)');
      }
    }
    return parts.join('\n\n');
  }

  queuePrefetchAll(query: string, options?: { sessionId?: string }): void {
    for (const p of this.providers) {
      try {
        p.queuePrefetch(query, options);
      } catch (err) {
        log.debug({ err, name: p.name }, 'queuePrefetch failed (non-fatal)');
      }
    }
  }

  syncAll(userContent: string, assistantContent: string, options?: { sessionId?: string }): void {
    for (const p of this.providers) {
      try {
        p.syncTurn(userContent, assistantContent, options);
      } catch (err) {
        log.warn({ err, name: p.name }, 'syncTurn failed');
      }
    }
  }

  getAdditionalTools(): AgentTool[] {
    const out: AgentTool[] = [];
    const seen = new Set<string>();
    for (const p of this.providers) {
      if (p.name === 'builtin') {
        continue;
      }
      try {
        for (const t of p.getToolSchemas()) {
          if (t.name && !seen.has(t.name)) {
            seen.add(t.name);
            out.push(t);
          }
        }
      } catch (err) {
        log.warn({ err, name: p.name }, 'getToolSchemas failed');
      }
    }
    return out;
  }

  async handleToolCall(toolName: string, args: Record<string, unknown>): Promise<string> {
    const provider = this.toolToProvider.get(toolName);
    if (!provider) {
      throw new Error(`No memory provider handles tool '${toolName}'`);
    }
    return provider.handleToolCall(toolName, args);
  }

  onMemoryWrite(action: 'add' | 'replace' | 'remove', target: 'memory' | 'user', content: string): void {
    for (const p of this.providers) {
      if (p.name === 'builtin') {
        continue;
      }
      try {
        p.onMemoryWrite?.(action, target, content);
      } catch (err) {
        log.debug({ err, name: p.name }, 'onMemoryWrite failed');
      }
    }
  }

  async initializeAll(sessionId: string, options?: MemoryProviderInitOptions): Promise<void> {
    for (const p of this.providers) {
      try {
        await p.initialize(sessionId, options);
      } catch (err) {
        log.warn({ err, name: p.name }, 'initialize failed');
      }
    }
  }

  async shutdownAll(): Promise<void> {
    for (const p of [...this.providers].reverse()) {
      try {
        await p.shutdown();
      } catch (err) {
        log.warn({ err, name: p.name }, 'shutdown failed');
      }
    }
  }
}
