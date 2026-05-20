import type { AgentMessage } from '@earendil-works/pi-agent-core';

import type { Config } from '../../config/schema.js';
import type { SessionStore } from '../../session/store.js';
import { buildSessionStartupContextPrelude, shouldApplyStartupContext } from './startup-context.js';

function extractTextFromUserMessage(message: AgentMessage): string {
  const content = (message as { content?: unknown }).content;
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .filter(
        (block): block is { type: 'text'; text: string } =>
          !!block && typeof block === 'object' && (block as { type?: string }).type === 'text',
      )
      .map((block) => block.text)
      .join('');
  }
  return '';
}

function prependTextToUserMessage(message: AgentMessage, prefix: string): AgentMessage {
  const trimmedPrefix = prefix.trim();
  if (!trimmedPrefix) {
    return message;
  }
  const content = (message as { content?: unknown }).content;
  if (typeof content === 'string') {
    return { ...(message as object), content: `${trimmedPrefix}\n\n${content}` } as AgentMessage;
  }
  if (Array.isArray(content)) {
    const blocks = [...content];
    const firstTextIndex = blocks.findIndex(
      (block) => !!block && typeof block === 'object' && (block as { type?: string }).type === 'text',
    );
    if (firstTextIndex >= 0) {
      const first = blocks[firstTextIndex] as { type: 'text'; text: string };
      blocks[firstTextIndex] = { ...first, text: `${trimmedPrefix}\n\n${first.text}` };
      return { ...(message as object), content: blocks } as AgentMessage;
    }
    return {
      ...(message as object),
      content: [{ type: 'text', text: trimmedPrefix }, ...blocks],
    } as AgentMessage;
  }
  return { ...(message as object), content: trimmedPrefix } as AgentMessage;
}

async function isBareSessionTurn(sessionStore: SessionStore, sessionKey: string): Promise<boolean> {
  try {
    const messages = await sessionStore.loadMessages(sessionKey);
    return !messages.some((message) => message.role === 'user');
  } catch {
    return true;
  }
}

export async function applyStartupContextToUserMessage(params: {
  userMessage: AgentMessage;
  sessionKey: string;
  workspaceDir: string;
  cfg?: Config;
  sessionStore: SessionStore;
  startupAction?: 'new' | 'reset';
  force?: boolean;
}): Promise<AgentMessage> {
  const action = params.startupAction ?? 'new';
  if (!params.force && !(await isBareSessionTurn(params.sessionStore, params.sessionKey))) {
    return params.userMessage;
  }
  if (!shouldApplyStartupContext({ cfg: params.cfg, action })) {
    return params.userMessage;
  }
  const prelude = buildSessionStartupContextPrelude({
    workspaceDir: params.workspaceDir,
    cfg: params.cfg,
  });
  if (!prelude?.trim()) {
    return params.userMessage;
  }
  if (extractTextFromUserMessage(params.userMessage).includes('[Startup context loaded by runtime]')) {
    return params.userMessage;
  }
  return prependTextToUserMessage(params.userMessage, prelude);
}
