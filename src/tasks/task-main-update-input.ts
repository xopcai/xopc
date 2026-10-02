import type { SessionInputStatus } from '../storage/sqlite/session-input-repository.js';

type InputState = { status: SessionInputStatus; error?: string };

export function selectTaskMainUpdateAttempt(
  conversationId: string,
  baseClientMessageId: string,
  findInput: (conversationId: string, clientMessageId: string) => InputState | undefined,
): { kind: 'completed' | 'accepted' | 'new' | 'exhausted'; clientMessageId?: string } {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const clientMessageId = attempt === 0 ? baseClientMessageId : `${baseClientMessageId}:retry:${attempt}`;
    const existing = findInput(conversationId, clientMessageId);
    if (existing?.status === 'completed' || existing?.status === 'suspended') {
      return { kind: 'completed', clientMessageId };
    }
    if (existing && ['failed', 'cancelled', 'interrupted'].includes(existing.status)) continue;
    return { kind: existing ? 'accepted' : 'new', clientMessageId };
  }
  return { kind: 'exhausted' };
}

/** Reuses an accepted input across restarts and gives failed attempts a fresh idempotency key. */
export async function submitAndConfirmTaskMainUpdate(
  input: { conversationId: string; clientMessageId: string; content: string },
  deps: {
    findInput: (conversationId: string, clientMessageId: string) => InputState | undefined;
    submit: (message: typeof input) => Promise<boolean>;
    waitForCompletion: (conversationId: string, clientMessageId: string) => Promise<void>;
  },
): Promise<boolean> {
  const attempt = selectTaskMainUpdateAttempt(input.conversationId, input.clientMessageId, deps.findInput);
  if (attempt.kind === 'completed') return true;
  if (attempt.kind === 'exhausted' || !attempt.clientMessageId) throw new Error('Task update retry limit reached');
  if (attempt.kind === 'new' && !await deps.submit({ ...input, clientMessageId: attempt.clientMessageId })) return false;
  await deps.waitForCompletion(input.conversationId, attempt.clientMessageId);
  const settled = deps.findInput(input.conversationId, attempt.clientMessageId);
  if (settled?.status === 'completed' || settled?.status === 'suspended') return true;
  throw new Error(settled?.error ?? 'Task update input did not complete');
}
