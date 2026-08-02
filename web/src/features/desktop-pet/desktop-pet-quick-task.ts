import { MessageSender, type MessagingCallbacks } from '@/features/chat/messages/message-sender';
import { SessionManager } from '@/features/chat/session/session-manager';
import { apiFetch } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export type DesktopPetClarifyPrompt = {
  requestId: string;
  question: string;
  choices?: string[];
  default?: string;
};

export type DesktopPetQuickTaskCallbacks = {
  onSession: (sessionKey: string) => void;
  onStarted: () => void;
  onTool: (toolName: string) => void;
  onClarify: (prompt: DesktopPetClarifyPrompt) => void;
  onCompleted: () => void;
  onError: (message: string) => void;
};

type QuickTaskDependencies = {
  createSession: () => Promise<{ key: string }>;
  send: (message: string, sessionKey: string, callbacks: MessagingCallbacks) => Promise<void>;
};

function messagingCallbacks(callbacks: DesktopPetQuickTaskCallbacks): MessagingCallbacks {
  return {
    onStreamStart: callbacks.onStarted,
    onToken: () => {},
    onThinking: () => {},
    onThinkingEnd: () => {},
    onToolStart: (toolName) => callbacks.onTool(toolName),
    onToolEnd: () => {},
    onProgress: () => {},
    onClarifyRequest: callbacks.onClarify,
    onResult: callbacks.onCompleted,
    onError: callbacks.onError,
  };
}

function defaultDependencies(): QuickTaskDependencies {
  const sessions = new SessionManager();
  const sender = new MessageSender();
  return {
    createSession: () => sessions.createSession(),
    send: (message, sessionKey, callbacks) => sender.send(message, sessionKey, undefined, undefined, callbacks),
  };
}

export async function runDesktopPetQuickTask(
  rawMessage: string,
  callbacks: DesktopPetQuickTaskCallbacks,
  dependencies: QuickTaskDependencies = defaultDependencies(),
): Promise<string> {
  const message = rawMessage.trim();
  if (!message) throw new Error('A task is required');
  const session = await dependencies.createSession();
  callbacks.onSession(session.key);
  await dependencies.send(message, session.key, messagingCallbacks(callbacks));
  return session.key;
}

export async function answerDesktopPetClarify(requestId: string, answer: string): Promise<void> {
  const res = await apiFetch(apiUrl(`/api/clarify/${encodeURIComponent(requestId)}`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answer: answer.trim() }),
  });
  if (res.ok) return;
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  throw new Error(body.error?.message ?? res.statusText ?? 'Clarify failed');
}
