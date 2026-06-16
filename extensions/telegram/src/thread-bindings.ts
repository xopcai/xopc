/**
 * Thread bindings (/focus) — scaffold for OpenClaw parity (Phase 4).
 * Full implementation requires subagent spawn + session focus routing.
 */

export interface TelegramThreadBinding {
  sessionKey: string;
  chatId: string;
  threadId?: string;
  createdAtMs: number;
  lastActivityMs: number;
}

const bindings = new Map<string, TelegramThreadBinding>();

function bindingKey(chatId: string, threadId?: string): string {
  return threadId ? `${chatId}:topic:${threadId}` : chatId;
}

export function setTelegramThreadBinding(binding: TelegramThreadBinding): void {
  bindings.set(bindingKey(binding.chatId, binding.threadId), binding);
}

export function getTelegramThreadBinding(chatId: string, threadId?: string): TelegramThreadBinding | undefined {
  return bindings.get(bindingKey(chatId, threadId));
}

export function clearTelegramThreadBinding(chatId: string, threadId?: string): void {
  bindings.delete(bindingKey(chatId, threadId));
}

export function sweepIdleTelegramThreadBindings(idleTimeoutMs: number): void {
  const now = Date.now();
  for (const [key, binding] of bindings) {
    if (now - binding.lastActivityMs > idleTimeoutMs) {
      bindings.delete(key);
    }
  }
}
