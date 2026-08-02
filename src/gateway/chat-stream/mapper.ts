import type { AgentMessage } from '@earendil-works/pi-agent-core';

import type { EmbeddedStreamEvent } from '../../agent/embedded/types.js';
import { createPetFeedback } from './pet-feedback.js';
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
  private currentAssistantReviewEmitted = false;
  private toolCallToMessageId = new Map<string, string>();
  private turnDiffs: string[] = [];
  private turnDiffFiles = new Set<string>();
  private turnDiffAdded = 0;
  private turnDiffRemoved = 0;
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
      case 'assistant_snapshot':
        return this.mapAssistantSnapshot(event.message);
      case 'message_end':
        return this.mapMessageEnd(event.message);
      case 'tool_execution_start':
        return this.mapToolStart(event);
      case 'tool_execution_update':
        return this.mapToolUpdate(event);
      case 'tool_execution_end':
        return this.mapToolEnd(event);
      case 'review_start':
        return [this.make('review_start', {
          messageId: this.ensureAssistantMessageId(),
          reviewId: String(event.reviewId ?? ''),
          target: String(event.target ?? 'working tree changes'),
          stage: event.stage === 'preparing' ? 'preparing' : 'reviewing',
        })];
      case 'review_delta':
        return [this.make('review_delta', {
          messageId: this.ensureAssistantMessageId(),
          reviewId: String(event.reviewId ?? ''),
          delta: String(event.delta ?? ''),
        })];
      case 'review_end':
        return [this.make('review_end', {
          messageId: this.ensureAssistantMessageId(),
          reviewId: String(event.reviewId ?? ''),
          status: event.status === 'error' ? 'error' : 'complete',
          ...(typeof event.message === 'string' && event.message ? { message: event.message } : {}),
        })];
      case 'user_message':
        return [this.make('user_message', { message: userMessageFromEvent(event) })];
      case 'user_transcript':
        return [this.make('user_transcript', { text: String(event.text ?? ''), media: event.media })];
      case 'progress': {
        const completed = typeof event.completed === 'number' ? event.completed : undefined;
        const total = typeof event.total === 'number' ? event.total : undefined;
        return [
          this.make('progress', {
            stage: String(event.stage ?? ''),
            message: String(event.message ?? ''),
            ...(typeof event.detail === 'string' ? { detail: event.detail } : {}),
            ...(typeof event.toolName === 'string' ? { toolName: event.toolName } : {}),
            ...(completed !== undefined ? { completed } : {}),
            ...(total !== undefined ? { total } : {}),
            petFeedback: createPetFeedback('progress', {
              publicSummary: typeof event.publicSummary === 'string' ? event.publicSummary : undefined,
              progress: { completed, total },
            }),
          }),
        ];
      }
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
            petFeedback: createPetFeedback('clarify'),
          }),
        ];
      case 'memory_consent_required':
        return [
          this.make('memory_consent_required', {
            requests: Array.isArray(event.requests)
              ? event.requests.flatMap((raw) => {
                  if (!raw || typeof raw !== 'object') return [];
                  const request = raw as Record<string, unknown>;
                  const id = typeof request.id === 'string' ? request.id : '';
                  const recordId = typeof request.recordId === 'string' ? request.recordId : '';
                  const statement = typeof request.statement === 'string' ? request.statement : '';
                  const purpose = typeof request.purpose === 'string' ? request.purpose : '';
                  return id && recordId && statement ? [{ id, recordId, statement, purpose }] : [];
                })
              : [],
          }),
        ];
      case 'memory_captured':
        return [
          this.make('memory_captured', {
            records: Array.isArray(event.records)
              ? event.records.flatMap((raw) => {
                  if (!raw || typeof raw !== 'object') return [];
                  const record = raw as Record<string, unknown>;
                  const id = typeof record.id === 'string' ? record.id : '';
                  const content = typeof record.content === 'string' ? record.content : '';
                  const kind = typeof record.kind === 'string' ? record.kind : '';
                  return id && content ? [{ id, content, kind }] : [];
                })
              : [],
          }),
        ];
      case 'error':
        return [this.make('error', {
          code: 'AGENT_RUN_ERROR',
          message: String(event.content ?? event.message ?? 'Unknown error'),
          petFeedback: createPetFeedback('error', { recoverable: event.recoverable === true }),
        })];
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
    return [this.make('run_end', {
      status,
      summary,
      petFeedback: createPetFeedback(status === 'success' ? 'success' : 'error', { recoverable: status !== 'error' }),
    })];
  }

  error(message: string, code = 'AGENT_RUN_ERROR'): ChatStreamEvent[] {
    return [this.make('error', { code, message, petFeedback: createPetFeedback('error', { recoverable: false }) })];
  }

  private mapMessageStart(raw: unknown): ChatStreamEvent[] {
    const message = raw as AgentMessage | undefined;
    if (message?.role !== 'assistant') return [];
    const messageId = this.nextAssistantMessageId();
    this.currentAssistantMessageId = messageId;
    this.currentAssistantText = '';
    this.currentAssistantReviewEmitted = false;
    return [this.make('assistant_message_start', { messageId })];
  }

  private mapMessageUpdate(event: { [key: string]: unknown }): ChatStreamEvent[] {
    const message = event.message as AgentMessage | undefined;
    if (message?.role !== 'assistant') return [];
    const messageId = this.ensureAssistantMessageId();
    const events: ChatStreamEvent[] = [];
    const review = extractReview(message);
    if (review && !this.currentAssistantReviewEmitted) {
      this.currentAssistantReviewEmitted = true;
      events.push(this.make('review', { messageId, review }));
    }
    const delta = event.assistantMessageEvent as { type?: unknown; delta?: unknown } | undefined;
    if (delta?.type === 'text_delta' && typeof delta.delta === 'string' && delta.delta) {
      events.push(this.make('assistant_delta', { messageId, delta: delta.delta }));
      this.currentAssistantText += delta.delta;
    }
    if (delta?.type === 'thinking_delta' && typeof delta.delta === 'string' && delta.delta) {
      events.push(this.make('thinking_delta', { messageId, delta: delta.delta }));
    }
    if (!delta) {
      const text = extractTextFromMessage(message);
      const suffix = appendSuffix(this.currentAssistantText, text);
      if (suffix) {
        events.push(this.make('assistant_delta', { messageId, delta: suffix }));
        this.currentAssistantText = text || `${this.currentAssistantText}${suffix}`;
      }
    }
    return events;
  }

  private mapAssistantSnapshot(raw: unknown): ChatStreamEvent[] {
    const message = raw as AgentMessage | undefined;
    if (message?.role !== 'assistant') return [];
    const messageId = this.ensureAssistantMessageId();
    const review = extractReview(message);
    if (review && !this.currentAssistantReviewEmitted) {
      this.currentAssistantReviewEmitted = true;
      return [this.make('review', { messageId, review })];
    }
    const text = extractTextFromMessage(message);
    const suffix = appendSuffix(this.currentAssistantText, text);
    if (!suffix) return [];
    this.currentAssistantText = text || `${this.currentAssistantText}${suffix}`;
    return [this.make('assistant_delta', { messageId, delta: suffix })];
  }

  private mapMessageEnd(raw: unknown): ChatStreamEvent[] {
    const message = raw as AgentMessage | undefined;
    if (message?.role !== 'assistant') return [];
    const messageId = this.ensureAssistantMessageId();
    const events: ChatStreamEvent[] = [];
    const review = extractReview(message);
    if (review && !this.currentAssistantReviewEmitted) {
      this.currentAssistantReviewEmitted = true;
      events.push(this.make('review', { messageId, review }));
    }
    const text = extractTextFromMessage(message);
    const suffix = appendSuffix(this.currentAssistantText, text);
    if (suffix) events.push(this.make('assistant_delta', { messageId, delta: suffix }));
    this.currentAssistantText = text || this.currentAssistantText;
    events.push(this.make('thinking_end', { messageId }));
    if (this.turnDiffs.length > 0) {
      events.push(
        this.make('turn_diff', {
          messageId,
          files: [...this.turnDiffFiles],
          diff: this.turnDiffs.join('\n'),
          added: this.turnDiffAdded,
          removed: this.turnDiffRemoved,
        }),
      );
      this.turnDiffs = [];
      this.turnDiffFiles.clear();
      this.turnDiffAdded = 0;
      this.turnDiffRemoved = 0;
    }
    events.push(this.make('assistant_message_end', { messageId, usage: extractUsage(message) }));
    this.lastAssistantMessageId = messageId;
    this.currentAssistantMessageId = undefined;
    this.currentAssistantText = '';
    this.currentAssistantReviewEmitted = false;
    return events;
  }

  private mapToolStart(event: { [key: string]: unknown }): ChatStreamEvent[] {
    const toolCallId = String(event.toolCallId ?? '');
    if (!toolCallId) return [];
    const messageId = this.ensureAssistantMessageId();
    const toolName = String(event.toolName ?? 'unknown');
    this.toolCallToMessageId.set(toolCallId, messageId);
    const events: ChatStreamEvent[] = [
      this.make('tool_start', {
        messageId,
        toolCallId,
        toolName,
        args: event.args,
      }),
    ];
    if (toolName === 'exec_command') {
      const args = asRecord(event.args);
      events.push(
        this.make('command_started', {
          messageId,
          toolCallId,
          command: String(args?.cmd ?? args?.command ?? ''),
          cwd: typeof args?.cwd === 'string' ? args.cwd : undefined,
        }),
      );
    }
    return events;
  }

  private mapToolUpdate(event: { [key: string]: unknown }): ChatStreamEvent[] {
    const toolCallId = String(event.toolCallId ?? '');
    if (!toolCallId) return [];
    const messageId = this.toolCallToMessageId.get(toolCallId) ?? this.ensureAssistantMessageId();
    const partial = event.partialResult;
    const details = extractDetails(partial);
    const textDelta = extractText(partial);
    const toolName = String(event.toolName ?? 'unknown');
    const events: ChatStreamEvent[] = [
      this.make('tool_update', {
        messageId,
        toolCallId,
        toolName,
        details,
        textDelta,
      }),
    ];
    if (toolName === 'exec_command') {
      const rec = asRecord(details);
      if (rec?.kind === 'command_output_delta') {
        const stream = rec.stream === 'stderr' ? 'stderr' : 'stdout';
        const delta = typeof rec.delta === 'string' ? rec.delta : '';
        if (delta) {
          events.push(this.make('command_output_delta', { messageId, toolCallId, stream, delta }));
        }
      }
    }
    return events;
  }

  private mapToolEnd(event: { [key: string]: unknown }): ChatStreamEvent[] {
    const toolCallId = String(event.toolCallId ?? '');
    if (!toolCallId) return [];
    const messageId = this.toolCallToMessageId.get(toolCallId) ?? this.ensureAssistantMessageId();
    const result = normalizeToolResult(event.result);
    const toolName = String(event.toolName ?? 'unknown');
    const events: ChatStreamEvent[] = [
      this.make('tool_end', {
        messageId,
        toolCallId,
        toolName,
        status: event.isError ? 'error' : 'success',
        result,
        errorMessage: event.isError ? result?.text : undefined,
      }),
    ];
    const details = asRecord(result?.details);
    if (toolName === 'exec_command' && details) {
      events.push(
        this.make('command_completed', {
          messageId,
          toolCallId,
          command: typeof details.command === 'string' ? details.command : '',
          cwd: typeof details.cwd === 'string' ? details.cwd : undefined,
          exitCode: typeof details.exitCode === 'number' ? details.exitCode : null,
          durationMs: typeof details.durationMs === 'number' ? details.durationMs : undefined,
          timedOut: details.timedOut === true,
          truncated: details.truncated === true,
        }),
      );
    }
    if (toolName === 'apply_patch' && details) {
      const changes = Array.isArray(details.changes) ? details.changes : [];
      const diff = typeof details.diff === 'string' ? details.diff : '';
      const added = typeof details.added === 'number' ? details.added : 0;
      const removed = typeof details.removed === 'number' ? details.removed : 0;
      if (diff || changes.length > 0) {
        this.recordPatchDiff(details);
        events.push(this.make('patch_applied', { messageId, toolCallId, changes, diff, added, removed }));
      }
    }
    if (toolName === 'update_plan' && details) {
      const plan = extractTurnPlan(details);
      if (plan) {
        events.push(this.make('turn_plan', { messageId, ...plan }));
      }
    }
    return events;
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

  private recordPatchDiff(details: Record<string, unknown>): void {
    const diff = typeof details.diff === 'string' ? details.diff : '';
    if (diff) this.turnDiffs.push(diff);
    if (typeof details.added === 'number') this.turnDiffAdded += details.added;
    if (typeof details.removed === 'number') this.turnDiffRemoved += details.removed;
    const changes = Array.isArray(details.changes) ? details.changes : [];
    for (const change of changes) {
      const rec = asRecord(change);
      const path = typeof rec?.moveTo === 'string'
        ? rec.moveTo
        : typeof rec?.path === 'string'
          ? rec.path
          : undefined;
      if (path) this.turnDiffFiles.add(path);
    }
  }
}

function userMessageFromEvent(event: { [key: string]: unknown }): unknown {
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

function extractReview(message: AgentMessage): unknown {
  const metadata = (message as { metadata?: unknown }).metadata;
  const metadataReview = asRecord(metadata)?.review;
  if (isReviewBlock(metadataReview)) return metadataReview;
  const content = (message as { content?: unknown }).content;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (isReviewBlock(block)) return block;
    }
  }
  return undefined;
}

function isReviewBlock(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && (value as { type?: unknown }).type === 'review';
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
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

function extractTurnPlan(details: Record<string, unknown>): { explanation?: string; plan: { step: string; status: 'pending' | 'in_progress' | 'completed' }[] } | undefined {
  const rawPlan = Array.isArray(details.plan) ? details.plan : [];
  const plan = rawPlan
    .map((item) => {
      const rec = asRecord(item);
      const step = typeof rec?.step === 'string' ? rec.step.trim() : '';
      const status = rec?.status;
      if (!step || (status !== 'pending' && status !== 'in_progress' && status !== 'completed')) {
        return undefined;
      }
      return { step, status };
    })
    .filter((item): item is { step: string; status: 'pending' | 'in_progress' | 'completed' } => Boolean(item));
  if (plan.length === 0) return undefined;
  const explanation = typeof details.explanation === 'string' && details.explanation.trim()
    ? details.explanation.trim()
    : undefined;
  return { explanation, plan };
}
