import { apiFetch } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export type TextAssistIntent = 'improve' | 'expand' | 'shorten' | 'fix';
export type TextAssistFormat = 'markdown' | 'plain';
export type TextAssistScenario =
  | 'generic.text'
  | 'cron.message'
  | 'cron.workflowGoal'
  | 'workflow.arg'
  | 'workflow.goal'
  | 'automation.instruction'
  | 'automation.workflowGoal'
  | 'automation.workflowInput';

export interface TextAssistRequest {
  scenario?: TextAssistScenario;
  intent?: TextAssistIntent;
  field?: {
    id?: string;
    label?: string;
    format?: TextAssistFormat;
  };
  input?: string;
  locale?: string;
  context?: Record<string, unknown>;
}

export interface TextAssistResponse {
  text: string;
  thinking?: string;
}

interface TextAssistStreamPayload {
  type?: string;
  delta?: string;
  text?: string;
  message?: string;
  error?: { message?: string } | string;
}

function parseSseData(raw: string): TextAssistStreamPayload | null {
  if (!raw.trim()) return null;
  try {
    return JSON.parse(raw) as TextAssistStreamPayload;
  } catch {
    return null;
  }
}

function getSseErrorMessage(payload: TextAssistStreamPayload): string {
  if (typeof payload.message === 'string' && payload.message.trim()) return payload.message;
  if (typeof payload.error === 'string' && payload.error.trim()) return payload.error;
  if (payload.error && typeof payload.error === 'object' && typeof payload.error.message === 'string') {
    return payload.error.message;
  }
  return 'AI suggestion failed';
}

function handleSseBlock(
  block: string,
  options: { onDelta?: (text: string) => void; onThinkingDelta?: (text: string) => void } = {},
): string | null {
  const data = block
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n');
  const payload = parseSseData(data);
  if (!payload) return null;

  if (payload.type === 'text_delta' && typeof payload.delta === 'string') {
    options.onDelta?.(payload.delta);
    return null;
  }
  if (payload.type === 'thinking_delta' && typeof payload.delta === 'string') {
    options.onThinkingDelta?.(payload.delta);
    return null;
  }
  if (payload.type === 'done' && typeof payload.text === 'string') {
    return payload.text;
  }
  if (payload.type === 'error') {
    throw new Error(getSseErrorMessage(payload));
  }
  return null;
}

export async function requestTextAssist(
  request: TextAssistRequest,
  options: { onDelta?: (text: string) => void; onThinkingDelta?: (text: string) => void } = {},
): Promise<TextAssistResponse> {
  const res = await apiFetch(apiUrl('/api/ai/text-assist'), {
    method: 'POST',
    headers: { Accept: 'text/event-stream' },
    body: JSON.stringify(request),
  });

  if (!res.ok) {
    const errorBody = (await res.json().catch(() => ({}))) as {
      error?: string | { message?: string };
    };
    const serverMessage =
      typeof errorBody.error === 'string' ? errorBody.error : errorBody.error?.message;
    throw new Error(serverMessage || `AI suggestion failed (${res.status})`);
  }

  if (!res.body) {
    const fallback = (await res.json().catch(() => null)) as TextAssistResponse | null;
    if (fallback?.text) return fallback;
    throw new Error('AI suggestion stream is empty');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let thinking = '';

  while (true) {
    const { done, value } = await reader.read();
    if (value) {
      buffer += decoder.decode(value, { stream: !done });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() ?? '';
      for (const block of blocks) {
        const finalText = handleSseBlock(block, {
          onDelta: (delta) => {
            text += delta;
            options.onDelta?.(delta);
          },
          onThinkingDelta: (delta) => {
            thinking += delta;
            options.onThinkingDelta?.(delta);
          },
        });
        if (finalText !== null) {
          text = finalText;
        }
      }
    }
    if (done) break;
  }

  if (buffer.trim()) {
    const finalText = handleSseBlock(buffer, {
      onDelta: (delta) => {
        text += delta;
        options.onDelta?.(delta);
      },
      onThinkingDelta: (delta) => {
        thinking += delta;
        options.onThinkingDelta?.(delta);
      },
    });
    if (finalText !== null) {
      text = finalText;
    }
  }

  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error('AI returned an empty suggestion');
  }
  return { text: trimmed, thinking: thinking.trim() || undefined };
}
