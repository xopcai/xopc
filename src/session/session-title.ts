/**
 * LLM-generated session titles (webchat and any path using SessionStore).
 */

import type { AgentMessage } from '@earendil-works/pi-agent-core';
import { complete, type UserMessage } from '@earendil-works/pi-ai/compat';

import { stripSessionStartupContextFromUserText } from '../agent/reply/startup-context.js';
import { stripEnvelopeTimestampPrefix } from '../channels/envelope-timestamp.js';
import { isCronSessionKey, parseSessionKey } from '../routing/session-key.js';
import { resolveModel } from '../providers/index.js';
import { createLogger } from '../utils/logger.js';
import { readAgentMessageContent } from '../agent/memory/agent-message-access.js';
import type { SessionStore } from './store.js';

const log = createLogger('SessionAutoTitle');

const MAX_TITLE_LEN = 80;

/** Collect visible text from any content block that exposes `text` (pi-ai / OpenAI / Anthropic shapes). */
function extractTextFromMessage(m: AgentMessage): string {
  const raw = readAgentMessageContent(m);
  if (typeof raw === 'string') return raw.trim();
  if (Array.isArray(raw)) {
    const parts: string[] = [];
    for (const c of raw) {
      if (c && typeof c === 'object') {
        const o = c as unknown as Record<string, unknown>;
        const type = typeof o.type === 'string' ? o.type : '';
        if (type === 'toolCall' || type === 'tool_use' || type === 'tool_result') continue;
        if (typeof o.text === 'string' && o.text.trim()) {
          parts.push(o.text.trim());
        }
      }
    }
    return parts.join(' ').trim();
  }
  return '';
}

function firstUserText(messages: AgentMessage[]): string {
  const u = messages.find((m) => m.role === 'user');
  if (!u) return '';
  const raw = extractTextFromMessage(u);
  return stripMediaClaimChecks(stripEnvelopeTimestampPrefix(stripSessionStartupContextFromUserText(raw)));
}

function stripMediaClaimChecks(text: string): string {
  if (!text.includes('[media attached:') && !text.includes('xopc-media-uri:')) {
    return text;
  }
  return text
    .replace(
      /\s*\[media attached:[^\]]+\]\s*\r?\nxopc-media-uri:[^\r\n]+\r?\n\s*xopc-media-path:[^\r\n]+(?:\r?\n\s*Use the read_media tool[^\r\n]*)?/g,
      '',
    )
    .replace(/\s*\[media attached:[^\]]+\]\s*/g, ' ')
    .replace(/\s*xopc-media-uri:[^\r\n]+/g, '')
    .replace(/\s*xopc-media-path:[^\r\n]+/g, '')
    .replace(/\s*Use the read_media tool[^\r\n]*/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** First assistant message that has visible text (skips tool-only assistant rows). */
function firstAssistantText(messages: AgentMessage[]): string {
  for (const m of messages) {
    if (m.role === 'assistant') {
      const t = extractTextFromMessage(m);
      if (t.length > 0) return t;
    }
  }
  return '';
}

export function isWebchatSessionKey(sessionKey: string): boolean {
  const p = parseSessionKey(sessionKey);
  if (p?.source === 'webchat') return true;
  return sessionKey.includes(':webchat:');
}

/** Whether to run LLM/fallback session naming for this key (excludes cron, heartbeat). */
export function shouldAutoTitleSessionKey(sessionKey: string): boolean {
  const raw = (sessionKey ?? '').trim();
  if (!raw) return false;
  if (isCronSessionKey(raw)) return false;
  if (raw.toLowerCase().startsWith('heartbeat:')) return false;
  return true;
}

export function sanitizeSessionTitle(raw: string): string {
  let s = raw.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  const lineBreak = s.indexOf('\n');
  if (lineBreak !== -1) s = s.slice(0, lineBreak).trim();
  if (s.length > MAX_TITLE_LEN) s = s.slice(0, MAX_TITLE_LEN - 1).trimEnd() + '…';
  return s;
}

export type SessionTitleSource = 'provisional' | 'llm' | 'user';

export function getSessionTitleSource(
  meta: { customData?: Record<string, unknown> } | null | undefined,
): SessionTitleSource | null {
  const raw = meta?.customData?.titleSource;
  if (raw === 'provisional' || raw === 'llm' || raw === 'user') return raw;
  return null;
}

/** Title from a single user message (first line), for immediate sidebar labels. */
export function provisionalTitleFromUserText(raw: string): string | null {
  const text = stripEnvelopeTimestampPrefix(
    stripSessionStartupContextFromUserText((raw ?? '').trim()),
  );
  if (!text) return null;
  const line = text.split(/\n/)[0]?.trim();
  if (!line) return null;
  return sanitizeSessionTitle(line);
}

/** Non-LLM title: first line of first user text, else first assistant line. */
export function fallbackTitleFromMessages(messages: AgentMessage[]): string | null {
  const u = firstUserText(messages);
  if (u) {
    const line = u.split(/\n/)[0]?.trim();
    if (line) return sanitizeSessionTitle(line);
  }
  const a = firstAssistantText(messages);
  if (a) {
    const line = a.split(/\n/)[0]?.trim();
    if (line) return sanitizeSessionTitle(line);
  }
  return null;
}

/**
 * Returns a title string, or null if generation should be skipped or failed.
 */
export async function generateSessionTitleFromMessages(
  modelRef: string,
  messages: AgentMessage[],
  signal?: AbortSignal,
): Promise<string | null> {
  const userText = firstUserText(messages);
  const assistantText = firstAssistantText(messages);
  if (!userText && !assistantText) return null;

  let model: ReturnType<typeof resolveModel>;
  try {
    model = resolveModel(modelRef);
  } catch (err) {
    log.warn({ err, modelRef }, 'Cannot resolve model for session title');
    return null;
  }

  const prompt =
    userText && assistantText
      ? `You label chat sessions. Given the first user message and the start of the assistant reply, output ONE short title (max 8 words). No quotes. No punctuation at the end. Use the same language as the user when possible.

User: ${userText.slice(0, 2000)}

Assistant: ${assistantText.slice(0, 2000)}

Title:`
      : userText
        ? `The assistant reply only used tools (no visible text yet). Output ONE short title (max 8 words) based only on the user's first message. No quotes. No punctuation at the end. Use the same language as the user.

User: ${userText.slice(0, 2000)}

Title:`
        : `Output ONE short title (max 8 words) for this assistant reply. No quotes. No punctuation at the end.

Assistant: ${assistantText!.slice(0, 2000)}

Title:`;

  const userMsg: UserMessage = { role: 'user', content: prompt, timestamp: Date.now() };

  try {
    const result = await complete(
      model,
      { messages: [userMsg] },
      {
        maxTokens: 64,
        temperature: 0.35,
        signal: signal as AbortSignal,
      },
    );

    let text = '';
    if (Array.isArray(result.content)) {
      for (const c of result.content) {
        if (c && typeof c === 'object' && (c as { type?: string }).type === 'text') {
          text += String((c as { text?: string }).text || '');
        }
      }
    }

    const cleaned = sanitizeSessionTitle(text);
    return cleaned.length > 0 ? cleaned : null;
  } catch (err) {
    log.warn({ err }, 'Session title LLM call failed');
    return null;
  }
}

export type SessionTitleUpdatedHook = (sessionKey: string, name: string) => void | Promise<void>;

/** Whether post-turn LLM refine may run (provisional or still unnamed; not user-locked). */
export function shouldRefineSessionTitleWithLlm(
  meta: { name?: string; customData?: Record<string, unknown> } | null | undefined,
): boolean {
  if (!meta) return false;
  const source = getSessionTitleSource(meta);
  if (source === 'user') return false;
  if (meta.name?.trim()) return source === 'provisional';
  return true;
}

function canAutoWriteTitle(meta: { name?: string; customData?: Record<string, unknown> } | null): boolean {
  if (!meta) return false;
  const source = getSessionTitleSource(meta);
  if (source === 'user') return false;
  return !meta.name?.trim();
}

/**
 * Set provisional title from first user text when session is still unnamed.
 * Skips cron/heartbeat keys and user-locked titles.
 */
export async function maybeSetProvisionalSessionTitle(
  sessionStore: SessionStore,
  sessionKey: string,
  userText?: string,
  onUpdated?: SessionTitleUpdatedHook,
): Promise<void> {
  if (!shouldAutoTitleSessionKey(sessionKey)) return;

  let meta = await sessionStore.getMetadata(sessionKey);
  if (!meta) return;
  if (!canAutoWriteTitle(meta)) return;

  let title: string | null = null;
  if (userText?.trim()) {
    title = provisionalTitleFromUserText(userText);
  }
  if (!title) {
    const messages = await sessionStore.load(sessionKey);
    if (!messages.length) return;
    title = fallbackTitleFromMessages(messages);
  }
  if (!title) return;

  try {
    await sessionStore.updateMetadata(sessionKey, {
      name: title,
      customData: { ...(meta.customData ?? {}), titleSource: 'provisional' },
    });
    await onUpdated?.(sessionKey, title);
  } catch (err) {
    log.warn({ err, sessionKey }, 'Session title: provisional updateMetadata failed');
  }
}

/**
 * LLM refine when title is empty or still provisional (not user-locked).
 */
export async function maybeRefineSessionTitleWithLlm(
  sessionStore: SessionStore,
  sessionKey: string,
  modelRef: string | undefined,
  onUpdated?: SessionTitleUpdatedHook,
): Promise<void> {
  if (!shouldAutoTitleSessionKey(sessionKey)) return;

  let messages = await sessionStore.load(sessionKey);
  if (!messages.length) return;

  let meta = await sessionStore.getMetadata(sessionKey);
  if (!meta) {
    await sessionStore.saveMessages(sessionKey, messages);
    meta = await sessionStore.getMetadata(sessionKey);
  }
  if (!meta) {
    log.warn({ sessionKey }, 'Session title: metadata missing after save');
    return;
  }
  if (!shouldRefineSessionTitleWithLlm(meta)) return;

  const source = getSessionTitleSource(meta);
  let title: string | null = null;
  const ref = modelRef?.trim();
  if (ref) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25_000);
    try {
      title = await generateSessionTitleFromMessages(ref, messages, controller.signal);
    } finally {
      clearTimeout(timeout);
    }
  }
  if (!title) {
    title = fallbackTitleFromMessages(messages);
  }
  if (!title) return;

  const existing = meta.name?.trim();
  if (existing === title) {
    if (source !== 'llm') {
      try {
        await sessionStore.updateMetadata(sessionKey, {
          customData: { ...(meta.customData ?? {}), titleSource: 'llm' },
        });
      } catch {
        /* ignore */
      }
    }
    return;
  }

  try {
    await sessionStore.updateMetadata(sessionKey, {
      name: title,
      customData: { ...(meta.customData ?? {}), titleSource: 'llm' },
    });
    await onUpdated?.(sessionKey, title);
  } catch (err) {
    log.warn({ err, sessionKey }, 'Session title: refine updateMetadata failed');
  }
}
