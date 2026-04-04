/**
 * LLM-generated session titles (webchat and any path using SessionStore).
 */

import type { AgentMessage } from '@mariozechner/pi-agent-core';
import { complete, type UserMessage } from '@mariozechner/pi-ai';

import { stripInboundFileMetadataFromText } from '../channels/attachments/inbound-persist.js';
import { isCronSessionKey, parseSessionKey } from '../routing/session-key.js';
import { resolveModel } from '../providers/index.js';
import { createLogger } from '../utils/logger.js';
import type { SessionStore } from './store.js';

const log = createLogger('SessionAutoTitle');

const MAX_TITLE_LEN = 80;

/** Collect visible text from any content block that exposes `text` (pi-ai / OpenAI / Anthropic shapes). */
function extractTextFromMessage(m: AgentMessage): string {
  if (typeof m.content === 'string') return m.content.trim();
  if (Array.isArray(m.content)) {
    const parts: string[] = [];
    for (const c of m.content) {
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
  // User turns include `formatInboundFileTextBlock` text blocks; do not feed [File:…] into title LLM / fallback.
  return stripInboundFileMetadataFromText(raw);
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

/**
 * If the session is still unnamed, set `name` (LLM when possible, else first-line fallback).
 * Skips cron/heartbeat keys. Ensures index row exists by re-saving when metadata is missing (fixes index lag).
 */
export async function maybeAutoTitleSessionStore(
  sessionStore: SessionStore,
  sessionKey: string,
  modelRef: string | undefined,
): Promise<void> {
  if (!shouldAutoTitleSessionKey(sessionKey)) return;

  let messages = await sessionStore.load(sessionKey);
  if (!messages.length) return;

  let meta = await sessionStore.getMetadata(sessionKey);
  if (!meta) {
    await sessionStore.save(sessionKey, messages);
    meta = await sessionStore.getMetadata(sessionKey);
  }
  if (!meta) {
    log.warn({ sessionKey }, 'Session title: metadata missing after save');
    return;
  }
  if (meta.name && meta.name.trim().length > 0) return;

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

  try {
    await sessionStore.updateMetadata(sessionKey, { name: title });
  } catch (err) {
    log.warn({ err, sessionKey }, 'Session title: updateMetadata failed');
  }
}
