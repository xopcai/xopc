import type { AgentMessage } from '@earendil-works/pi-agent-core';

import type { EmbeddedStreamEvent } from '../../agent/embedded/types.js';
import type { ChatStreamEvent, ChatStreamStatus } from './protocol.js';

export type RuntimeStreamEvent = EmbeddedStreamEvent | { type: string; [key: string]: unknown };

export interface ChatStreamMapperOptions {
  runId: string;
  sessionKey: string;
  channel: string;
}

type ToolResultEnvelope = { content?: unknown[]; details?: unknown; text?: string };

export class ChatStreamMapper {
  private assistantIndex = 0;
  private currentAssistantMessageId: string | undefined;
  private lastAssistantMessageId: string | undefined;
  private currentAssistantText = '';
  private toolCallToMessageId = new Map<string, string>();
  private started = false;
  private ended = false;

  constructor(private readonly opts: ChatStreamMapperOptions) {}

  map(input: RuntimeStreamEvent): ChatStreamEvent[] {
    const event = input as { type: string; [key: string]: unknown };
    switch (event.type) {
      case 'agent_start':
        return this.start();
      case 'agent_end':
        return [];
      case 'message_start':
        return this.mapMessageStart(event.message);
      case 'message_update':
        return this.mapMessageUpdate(event);
      case 'message_end':
        return this.mapMessageEnd(event.message);
      case 'tool_execution_start':
        return this.mapToolStart(event);
      case 'tool_execution_update':
        return this.mapToolUpdate(event);
      case 'tool_execution_end':
        return this.mapToolEnd(event);
      case 'user_message':
        return [this.make('user_message', { message: userMessageFromLegacyEvent(event) })];
      case 'user_transcript':
        return [this.make('user_transcript', { text: String(event.text ?? ''), media: event.media })];
      case 'progress':
        return [this.make('progress', { stage: String(event.stage ?? ''), message: String(event.message ?? '') })];
      case 'compaction':
        return [
          this.make('compaction', {
            status: event.status === 'completed' || event.status === 'skipped' ? event.status : 'started',
            tokensBefore: typeof event.tokensBefore === 'number' ? event.tokensBefore : undefined,
            tokensAfter: typeof event.tokensAfter === 'number' ? event.tokensAfter : undefined,
            summary: typeof event.summary === 'string' ? event.summary : undefined,
          }),
        ];
      case 'tts_audio':
        return [
          this.make('tts_audio', {
            uri: String(event.uri ?? ''),
            mimeType: String(event.mimeType ?? 'audio/mpeg'),
            name: String(event.name ?? 'voice.mp3'),
            attachTo: 'last_assistant',
            ...(this.lastAssistantMessageId ? { messageId: this.lastAssistantMessageId } : {}),
          }),
        ];
      case 'clarify_request':
        return [
          this.make('clarify_request', {
            requestId: String(event.requestId ?? ''),
            question: String(event.question ?? ''),
            choices: Array.isArray(event.choices) ? event.choices.filter((x): x is string => typeof x === 'string') : undefined,
            default: typeof event.default === 'string' ? event.default : undefined,
          }),
        ];
      case 'error':
        return [this.make('error', { code: 'AGENT_RUN_ERROR', message: String(event.content ?? event.message ?? 'Unknown error') })];
      default:
        return [];
    }
  }

  start(): ChatStreamEvent[] {
    if (this.started) return [];
    this.started = true;
    return [this.make('run_start', { channel: this.opts.channel })];
  }

  end(status: ChatStreamStatus, summary?: string): ChatStreamEvent[] {
    if (this.ended) return [];
    this.ended = true;
    return [this.make('run_end', { status, summary })];
  }

  error(message: string, code = 'AGENT_RUN_ERROR'): ChatStreamEvent[] {
    return [this.make('error', { code, message })];
  }

  private mapMessageStart(raw: unknown): ChatStreamEvent[] {
    const message = raw as AgentMessage | undefined;
    if (message?.role !== 'assistant') return [];
    const messageId = this.nextAssistantMessageId();
    this.currentAssistantMessageId = messageId;
    this.currentAssistantText = '';
    return [this.make('assistant_message_start', { messageId })];
  }

  private mapMessageUpdate(event: { [key: string]: unknown }): ChatStreamEvent[] {
    const message = event.message as AgentMessage | undefined;
    if (message?.role !== 'assistant') return [];
    const messageId = this.ensureAssistantMessageId();
    const delta = event.assistantMessageEvent as { type?: unknown; delta?: unknown } | undefined;
    if (delta?.type === 'text_delta' && typeof delta.delta === 'string' && delta.delta) {
      this.currentAssistantText += delta.delta;
      return [this.make('assistant_delta', { messageId, delta: delta.delta })];
    }
    if (delta?.type === 'thinking_delta' && typeof delta.delta === 'string' && delta.delta) {
      return [this.make('thinking_delta', { messageId, delta: delta.delta })];
    }

    const text = extractTextFromMessage(message);
    const suffix = appendSuffix(this.currentAssistantText, text);
    this.currentAssistantText = text || this.currentAssistantText;
    return suffix ? [this.make('assistant_delta', { messageId, delta: suffix })] : [];
  }

  private mapMessageEnd(raw: unknown): ChatStreamEvent[] {
    const message = raw as AgentMessage | undefined;
    if (message?.role !== 'assistant') return [];
    const messageId = this.ensureAssistantMessageId();
    const events: ChatStreamEvent[] = [];
    const text = extractTextFromMessage(message);
    const suffix = appendSuffix(this.currentAssistantText, text);
    if (suffix) events.push(this.make('assistant_delta', { messageId, delta: suffix }));
    this.currentAssistantText = text || this.currentAssistantText;
    events.push(this.make('thinking_end', { messageId }));
    events.push(this.make('assistant_message_end', { messageId, usage: extractUsage(message) }));
    this.lastAssistantMessageId = messageId;
    this.currentAssistantMessageId = undefined;
    this.currentAssistantText = '';
    return events;
  }

  private mapToolStart(event: { [key: string]: unknown }): ChatStreamEvent[] {
    const toolCallId = String(event.toolCallId ?? '');
    if (!toolCallId) return [];
    const messageId = this.ensureAssistantMessageId();
    this.toolCallToMessageId.set(toolCallId, messageId);
    return [
      this.make('tool_start', {
        messageId,
        toolCallId,
        toolName: String(event.toolName ?? 'unknown'),
        args: event.args,
      }),
    ];
  }

  private mapToolUpdate(event: { [key: string]: unknown }): ChatStreamEvent[] {
    const toolCallId = String(event.toolCallId ?? '');
    if (!toolCallId) return [];
    const messageId = this.toolCallToMessageId.get(toolCallId) ?? this.ensureAssistantMessageId();
    const partial = event.partialResult;
    const details = extractDetails(partial);
    const textDelta = extractText(partial);
    return [
      this.make('tool_update', {
        messageId,
        toolCallId,
        toolName: String(event.toolName ?? 'unknown'),
        details,
        textDelta,
      }),
    ];
  }

  private mapToolEnd(event: { [key: string]: unknown }): ChatStreamEvent[] {
    const toolCallId = String(event.toolCallId ?? '');
    if (!toolCallId) return [];
    const messageId = this.toolCallToMessageId.get(toolCallId) ?? this.ensureAssistantMessageId();
    const result = normalizeToolResult(event.result);
    return [
      this.make('tool_end', {
        messageId,
        toolCallId,
        toolName: String(event.toolName ?? 'unknown'),
        status: event.isError ? 'error' : 'success',
        result,
        errorMessage: event.isError ? result?.text : undefined,
      }),
    ];
  }

  private ensureAssistantMessageId(): string {
    if (!this.currentAssistantMessageId) {
      this.currentAssistantMessageId = this.nextAssistantMessageId();
    }
    return this.currentAssistantMessageId;
  }

  private nextAssistantMessageId(): string {
    this.assistantIndex += 1;
    return `msg_${this.opts.runId.replace(/[^a-zA-Z0-9_-]/g, '_')}_${this.assistantIndex}`;
  }

  private make<T extends ChatStreamEvent['type']>(
    type: T,
    payload: Extract<ChatStreamEvent, { type: T }>['payload'],
  ): Extract<ChatStreamEvent, { type: T }> {
    return {
      type,
      runId: this.opts.runId,
      sessionKey: this.opts.sessionKey,
      timestamp: Date.now(),
      payload,
    } as Extract<ChatStreamEvent, { type: T }>;
  }
}

function userMessageFromLegacyEvent(event: { [key: string]: unknown }): unknown {
  return {
    role: 'user',
    content: event.content ?? [],
    attachments: event.media,
    timestamp: typeof event.timestamp === 'number' ? event.timestamp : Date.now(),
  };
}

function extractTextFromMessage(message: AgentMessage): string {
  return extractText((message as { content?: unknown }).content);
}

function extractText(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return undefined;
  const text = value
    .map((block) => {
      if (!block || typeof block !== 'object') return '';
      const rec = block as { type?: unknown; text?: unknown };
      return rec.type === 'text' && typeof rec.text === 'string' ? rec.text : '';
    })
    .join('');
  return text || undefined;
}

function appendSuffix(base: string, next: string | undefined): string {
  if (!next) return '';
  if (!base) return next;
  if (next === base || base.endsWith(next)) return '';
  if (next.startsWith(base)) return next.slice(base.length);
  const max = Math.min(base.length, next.length, 512);
  for (let overlap = max; overlap > 0; overlap--) {
    if (base.slice(-overlap) === next.slice(0, overlap)) return next.slice(overlap);
  }
  return next;
}

function extractUsage(message: AgentMessage): AssistantMessageEndEventPayload['usage'] {
  const usage = (message as { usage?: unknown }).usage;
  if (!usage || typeof usage !== 'object') return undefined;
  const rec = usage as Record<string, unknown>;
  return {
    inputTokens: typeof rec.inputTokens === 'number' ? rec.inputTokens : undefined,
    outputTokens: typeof rec.outputTokens === 'number' ? rec.outputTokens : undefined,
    totalTokens: typeof rec.totalTokens === 'number' ? rec.totalTokens : undefined,
    cost: typeof rec.cost === 'number' ? rec.cost : undefined,
  };
}

type AssistantMessageEndEventPayload = Extract<ChatStreamEvent, { type: 'assistant_message_end' }>['payload'];

function extractDetails(value: unknown): unknown {
  if (!value || typeof value !== 'object') return undefined;
  return (value as Record<string, unknown>).details;
}

function normalizeToolResult(value: unknown): ToolResultEnvelope | undefined {
  if (value == null) return undefined;
  if (typeof value === 'string') return { text: value };
  if (typeof value !== 'object') return { text: String(value) };
  const rec = value as Record<string, unknown>;
  return {
    content: Array.isArray(rec.content) ? rec.content : undefined,
    details: rec.details,
    text: extractText(rec.content) ?? (typeof rec.text === 'string' ? rec.text : undefined),
  };
}
