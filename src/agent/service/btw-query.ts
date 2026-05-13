import type { AgentMessage } from '@earendil-works/pi-agent-core';
import { complete, type UserMessage } from '@earendil-works/pi-ai';

import { readAgentMessageContent } from '../memory/agent-message-access.js';
import type { SessionStore } from '../../session/index.js';
import { resolveModel } from '../../providers/index.js';

type BtwLog = { warn: (obj: Record<string, unknown>, msg: string) => void };

function formatMessagesForBtw(messages: AgentMessage[]): string {
  return messages
    .map((m) => {
      const role = m.role;
      let body = '';
      const raw = readAgentMessageContent(m);
      if (typeof raw === 'string') {
        body = raw;
      } else if (Array.isArray(raw)) {
        body = raw
          .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
          .map((c) => c.text || '')
          .join('\n');
      }
      const line = `[${role}]: ${body}`;
      return line.length > 4000 ? `${line.slice(0, 4000)}…` : line;
    })
    .join('\n\n');
}

/** One-shot LLM answer for /btw: transcript as background only; does not persist. */
export async function runBtwQuery(opts: {
  sessionKey: string;
  question: string;
  sessionStore: SessionStore;
  modelForSession: string;
  log: BtwLog;
}): Promise<{ text: string; error?: string }> {
  const q = opts.question.trim();
  if (!q) {
    return { text: '', error: 'Empty question.' };
  }
  const messages = await opts.sessionStore.load(opts.sessionKey);
  const modelRef = opts.modelForSession;
  let model;
  try {
    model = resolveModel(modelRef);
  } catch (err) {
    const em = err instanceof Error ? err.message : String(err);
    opts.log.warn({ err, modelRef, errorMessage: em }, 'btwQuery: model resolve failed');
    return { text: '', error: `Could not resolve model: ${modelRef}` };
  }

  const background = formatMessagesForBtw(messages.slice(-40));
  const systemBlock = [
    'You are answering an ephemeral /btw side question about the current conversation.',
    'Use the conversation only as background context.',
    'Answer only the side question. Do not continue or complete any unfinished task from the conversation.',
    'Do not use tools, shell, or file writes unless the question explicitly requires a tiny code snippet.',
    'If the question can be answered briefly, answer briefly.',
  ].join('\n');

  const userPrompt = [
    systemBlock,
    '',
    '---',
    'Conversation background (read-only):',
    background || '(empty)',
    '',
    '---',
    'Side question:',
    q,
  ].join('\n');

  const userMessage: UserMessage = { role: 'user', content: userPrompt, timestamp: Date.now() };
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 90_000);
  try {
    const out = await complete(model, { messages: [userMessage] }, {
      maxTokens: 2048,
      temperature: 0.4,
      signal: controller.signal as AbortSignal,
    });
    const text = Array.isArray(out.content)
      ? out.content
          .filter(
            (c): c is { type: 'text'; text: string } =>
              c.type === 'text' && typeof (c as { text?: unknown }).text === 'string',
          )
          .map((c) => c.text || '')
          .join('')
      : '';
    return { text: text.trim() };
  } catch (err) {
    const em = err instanceof Error ? err.message : String(err);
    opts.log.warn({ err, sessionKey: opts.sessionKey, errorMessage: em }, 'btwQuery failed');
    return { text: '', error: em };
  } finally {
    clearTimeout(timeoutId);
  }
}
