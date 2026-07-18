import type { AgentMessage } from '@earendil-works/pi-agent-core';
import { type UserMessage } from '@earendil-works/pi-ai/compat';

import { readAgentMessageContent } from '../memory/agent-message-access.js';
import type { SessionStore } from '../../session/index.js';
import type { CredentialResolverOptions } from '../../auth/credentials.js';
import { resolveModel } from '../../providers/index.js';
import { completeWithResolvedCredentials, resolveModelCallApiKey } from '../../providers/model-call.js';

type BtwLog = { warn: (obj: Record<string, unknown>, msg: string) => void };

function textFromCompleteContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .filter(
      (c): c is { type: 'text'; text: string } =>
        c?.type === 'text' && typeof (c as { text?: unknown }).text === 'string',
    )
    .map((c) => c.text || '')
    .join('');
}

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
  maxTokens?: number;
  temperature?: number;
  includeSessionContext?: boolean;
  credentialOptions?: CredentialResolverOptions;
}): Promise<{ text: string; error?: string }> {
  const q = opts.question.trim();
  if (!q) {
    return { text: '', error: 'Empty question.' };
  }
  const modelRef = opts.modelForSession;
  let model;
  try {
    model = resolveModel(modelRef);
  } catch (err) {
    const em = err instanceof Error ? err.message : String(err);
    opts.log.warn({ err, modelRef, errorMessage: em }, 'btwQuery: model resolve failed');
    return { text: '', error: `Could not resolve model: ${modelRef}` };
  }

  let apiKey: string | undefined;
  try {
    apiKey = await resolveModelCallApiKey(model, opts.credentialOptions);
  } catch (err) {
    const em = err instanceof Error ? err.message : String(err);
    opts.log.warn({ err, modelRef, provider: model.provider, errorMessage: em }, 'btwQuery: credential lookup failed');
    return { text: '', error: `Could not load credentials for provider: ${model.provider}` };
  }
  if (!apiKey) {
    opts.log.warn({ modelRef, provider: model.provider }, 'btwQuery: provider credentials are not configured');
    return { text: '', error: `No API key for provider: ${model.provider}` };
  }

  const includeSessionContext = opts.includeSessionContext ?? true;
  let userPrompt = q;
  if (includeSessionContext) {
    const messages = await opts.sessionStore.load(opts.sessionKey);
    const background = formatMessagesForBtw(messages.slice(-40));
    const systemBlock = [
      'You are answering an ephemeral /btw side question about the current conversation.',
      'Use the conversation only as background context.',
      'Answer only the side question. Do not continue or complete any unfinished task from the conversation.',
      'Do not use tools, commands, or file writes unless the question explicitly requires a tiny code snippet.',
      'If the question can be answered briefly, answer briefly.',
    ].join('\n');
    userPrompt = [
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
  }

  const userMessage: UserMessage = { role: 'user', content: userPrompt, timestamp: Date.now() };
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 90_000);
  try {
    const requestedMaxTokens = Math.max(1, Math.trunc(opts.maxTokens ?? 2048));
    const modelMaxTokens = typeof model.maxTokens === 'number' && Number.isFinite(model.maxTokens)
      ? Math.max(1, Math.trunc(model.maxTokens))
      : undefined;
    const out = await completeWithResolvedCredentials(model, { messages: [userMessage] }, {
      maxTokens: modelMaxTokens ? Math.min(requestedMaxTokens, modelMaxTokens) : requestedMaxTokens,
      signal: controller.signal as AbortSignal,
      apiKey,
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
    }, opts.credentialOptions);
    const response = out as {
      content?: unknown;
      stopReason?: unknown;
      errorMessage?: unknown;
      usage?: { output?: unknown; reasoning?: unknown };
    };
    const text = textFromCompleteContent(response.content).trim();
    if (text) return { text };

    const stopReason = typeof response.stopReason === 'string' ? response.stopReason : undefined;
    const errorMessage = typeof response.errorMessage === 'string' ? response.errorMessage.trim() : '';
    if (stopReason === 'error' && errorMessage) {
      opts.log.warn({ sessionKey: opts.sessionKey, modelRef, stopReason, errorMessage }, 'btwQuery model call failed');
      return { text: '', error: errorMessage };
    }
    const contentTypes = Array.isArray(response.content)
      ? response.content
        .map((block) => block && typeof block === 'object' && 'type' in block
          ? String((block as { type?: unknown }).type)
          : 'unknown')
        .join(', ')
      : undefined;
    const reasoningTokens = typeof response.usage?.reasoning === 'number' ? response.usage.reasoning : undefined;
    const detail = [
      stopReason ? `stop reason: ${stopReason}` : '',
      contentTypes ? `content: ${contentTypes}` : '',
      reasoningTokens != null ? `reasoning tokens: ${reasoningTokens}` : '',
    ].filter(Boolean).join('; ');
    const error = `No text returned from model${detail ? ` (${detail})` : ''}.`;
    opts.log.warn({
      sessionKey: opts.sessionKey,
      modelRef,
      stopReason,
      errorMessage: errorMessage || undefined,
      contentTypes,
      reasoningTokens,
    }, 'btwQuery returned no text');
    return { text: '', error };
  } catch (err) {
    const em = err instanceof Error ? err.message : String(err);
    opts.log.warn({ err, sessionKey: opts.sessionKey, errorMessage: em }, 'btwQuery failed');
    return { text: '', error: em };
  } finally {
    clearTimeout(timeoutId);
  }
}
