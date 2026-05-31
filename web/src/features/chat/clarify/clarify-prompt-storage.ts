import type { ClarifyPromptState } from '@/features/chat/composer/clarify-prompt';

const STORAGE_PREFIX = 'xopc.chat.clarifyPrompt:v1:';

function storageKey(sessionKey: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(sessionKey.trim())}`;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function parseClarifyPrompt(raw: unknown): ClarifyPromptState | null {
  if (!isRecord(raw)) return null;
  const requestId = raw.requestId;
  const question = raw.question;
  if (typeof requestId !== 'string' || !requestId.trim()) return null;
  if (typeof question !== 'string' || !question.trim()) return null;
  const choices = Array.isArray(raw.choices)
    ? (raw.choices as unknown[]).filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    : undefined;
  const def =
    typeof raw.default === 'string' && raw.default.trim() ? raw.default.trim() : undefined;
  return {
    requestId: requestId.trim(),
    question: question.trim(),
    choices: choices && choices.length >= 2 ? choices : undefined,
    default: def,
  };
}

export function readClarifyPromptSnapshot(sessionKey: string): ClarifyPromptState | null {
  const sk = sessionKey?.trim();
  if (!sk || typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(storageKey(sk));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return null;
    return parseClarifyPrompt(parsed.prompt ?? parsed);
  } catch {
    return null;
  }
}

export function writeClarifyPromptSnapshot(sessionKey: string, prompt: ClarifyPromptState): void {
  const sk = sessionKey?.trim();
  if (!sk || typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(storageKey(sk), JSON.stringify({ v: 1, prompt }));
  } catch {
    /* ignore quota */
  }
}

export function clearClarifyPromptSnapshot(sessionKey: string): void {
  const sk = sessionKey?.trim();
  if (!sk || typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(storageKey(sk));
  } catch {
    /* ignore */
  }
}
