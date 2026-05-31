/**
 * Session tool-result guard — wraps a pi `SessionManager.appendMessage` to:
 *   1. cap oversized tool-result text + details so they cannot blow up the next
 *      LLM request (size + persistence limits).
 *   2. track pending tool-call IDs so missing tool results can be synthesised
 *      (some providers refuse a turn that has an orphan tool_use block).
 *   3. drop assistant `toolCall` blocks whose tool name is not in the allowlist
 *      (these would also trigger provider 400s).
 *   4. broadcast `xopc:transcript-row` updates so the gateway UI can stream them.
 *
 * Previously this module shipped with three sibling files
 * (`session-tool-result-state.ts`, `session-raw-append-message.ts`,
 * `session-tool-result-guard-wrapper.ts`). They are now consolidated here as
 * private constructs around the `ToolResultGuard` class. Pi-coding-agent owns
 * the `SessionManager` instance and calls `appendMessage` from inside the
 * runtime, so we still need to monkey-patch that method — but the patched
 * implementation is just `guard.guardedAppend.bind(guard)` and all state lives
 * on the class.
 */

import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { SessionManager } from '@earendil-works/pi-coding-agent';

import type { Config } from '../../config/schema.js';
import {
  boundedJsonUtf8Bytes,
  firstEnumerableOwnKeys,
  jsonUtf8BytesOrInfinity,
  type BoundedJsonUtf8Bytes,
} from '../../infra/json-utf8-bytes.js';
import { emitSessionTranscriptUpdate } from '../../session/transcript-events.js';
import { normalizeOptionalString } from '../../utils/string-coerce.js';
import { formatContextLimitTruncationNotice } from './tool-result-context-guard.js';
import {
  DEFAULT_MAX_LIVE_TOOL_RESULT_CHARS,
  resolveLiveToolResultMaxChars,
  truncateToolResultMessage,
} from './tool-result-truncation.js';
import {
  makeMissingToolResult,
  sanitizeToolCallInputs,
} from '../transcript/session-transcript-repair.js';
import {
  extractToolCallsFromAssistant,
  extractToolResultId,
} from '../transcript/tool-call-id.js';

// ── Public surface ──────────────────────────────────────────────────────────

export type BeforeMessageWriteHookEvent = { message: AgentMessage };
export type BeforeMessageWriteHookResult =
  | { block?: boolean; message?: AgentMessage }
  | undefined;

export interface ToolResultGuardOptions {
  /** Optional session key for transcript update broadcasts. */
  sessionKey?: string;
  /** Optional transform applied to any message before persistence. */
  transformMessageForPersistence?: (message: AgentMessage) => AgentMessage;
  /**
   * Optional, synchronous transform applied to toolResult messages *before* they are
   * persisted to the session transcript.
   */
  transformToolResultForPersistence?: (
    message: AgentMessage,
    meta: { toolCallId?: string; toolName?: string; isSynthetic?: boolean },
  ) => AgentMessage;
  /**
   * Whether to synthesize missing tool results to satisfy strict providers.
   * Defaults to true.
   */
  allowSyntheticToolResults?: boolean;
  missingToolResultText?: string;
  /**
   * Optional set/list of tool names accepted for assistant toolCall/toolUse blocks.
   * When set, tool calls with unknown names are dropped before persistence.
   */
  allowedToolNames?: Iterable<string>;
  /**
   * Synchronous hook invoked before any message is written to the session JSONL.
   * If the hook returns { block: true }, the message is silently dropped.
   * If it returns { message }, the modified message is written instead.
   */
  beforeMessageWriteHook?: (event: BeforeMessageWriteHookEvent) => BeforeMessageWriteHookResult;
  maxToolResultChars?: number;
}

export interface InstallSessionToolResultGuardResult {
  flushPendingToolResults: () => void;
  clearPendingToolResults: () => void;
  getPendingIds: () => string[];
}

/** Idempotent wrapper that also adds the helper methods consumers expect. */
export type GuardedPiTranscriptManager = SessionManager & {
  flushPendingToolResults?: () => void;
  clearPendingToolResults?: () => void;
};

/**
 * Install the guard on a SessionManager and return its control API.
 * Subsequent assistant/toolResult writes by pi-coding-agent flow through the
 * guard transparently.
 */
export function installSessionToolResultGuard(
  sessionManager: SessionManager,
  opts: ToolResultGuardOptions = {},
): InstallSessionToolResultGuardResult {
  const guard = new ToolResultGuard(sessionManager, opts);
  guard.attach();
  return {
    flushPendingToolResults: () => guard.flushPending(),
    clearPendingToolResults: () => guard.clearPending(),
    getPendingIds: () => guard.getPendingIds(),
  };
}

/**
 * Convenience wrapper used by the embedded runner pool: install the guard
 * (idempotent), pin the size cap from the model context window, and expose
 * `flushPendingToolResults` / `clearPendingToolResults` directly on the
 * SessionManager instance so callers do not need to keep the install result.
 */
export function guardSessionManager(
  sessionManager: SessionManager,
  opts?: {
    agentId?: string;
    sessionKey?: string;
    config?: Config;
    contextWindowTokens?: number;
    allowSyntheticToolResults?: boolean;
    missingToolResultText?: string;
    allowedToolNames?: Iterable<string>;
  },
): GuardedPiTranscriptManager {
  if (typeof (sessionManager as GuardedPiTranscriptManager).flushPendingToolResults === 'function') {
    return sessionManager as GuardedPiTranscriptManager;
  }

  const result = installSessionToolResultGuard(sessionManager, {
    sessionKey: opts?.sessionKey,
    allowSyntheticToolResults: opts?.allowSyntheticToolResults,
    missingToolResultText: opts?.missingToolResultText,
    allowedToolNames: opts?.allowedToolNames,
    maxToolResultChars:
      typeof opts?.contextWindowTokens === 'number'
        ? resolveLiveToolResultMaxChars({
            contextWindowTokens: opts.contextWindowTokens,
            cfg: opts?.config,
            agentId: opts?.agentId,
          })
        : undefined,
  });
  const tagged = sessionManager as GuardedPiTranscriptManager;
  tagged.flushPendingToolResults = result.flushPendingToolResults;
  tagged.clearPendingToolResults = result.clearPendingToolResults;
  return tagged;
}

/**
 * Recover the original (un-guarded) appendMessage for a session manager.
 * Useful for callers that need a low-level "bypass the guard" write path.
 */
export function getRawSessionAppendMessage(
  sessionManager: SessionManager,
): SessionManager['appendMessage'] {
  const stored = (sessionManager as SessionManagerWithRawAppend)[RAW_APPEND_MESSAGE];
  return stored ?? sessionManager.appendMessage.bind(sessionManager);
}

// ── Internal: persistence + truncation helpers ──────────────────────────────

function resolveMaxToolResultChars(opts: { maxToolResultChars?: number }): number {
  return Math.max(1, opts.maxToolResultChars ?? DEFAULT_MAX_LIVE_TOOL_RESULT_CHARS);
}

function capToolResultSize(msg: AgentMessage, maxChars: number): AgentMessage {
  if ((msg as { role?: string }).role !== 'toolResult') {
    return msg;
  }
  return truncateToolResultMessage(msg, maxChars, {
    suffix: (truncatedChars) => formatContextLimitTruncationNotice(truncatedChars),
    minKeepChars: 2_000,
  });
}

// `details` is runtime/UI metadata, not model-visible tool output. Keep the
// session JSONL useful for debugging without letting metadata blobs dominate
// disk, replay repair, transcript broadcasts, or future tooling that reads raw
// sessions. Model-visible text belongs in tool result `content`.
const MAX_PERSISTED_TOOL_RESULT_DETAILS_BYTES = 8_192;
const MAX_PERSISTED_DETAIL_STRING_CHARS = 2_000;
const MAX_PERSISTED_DETAIL_SESSION_COUNT = 10;
const MAX_PERSISTED_DETAIL_FALLBACK_STRING_CHARS = 200;

function originalDetailsSizeFields(size: BoundedJsonUtf8Bytes): Record<string, number> {
  return size.complete
    ? { originalDetailsBytes: size.bytes }
    : { originalDetailsBytesAtLeast: size.bytes };
}

function truncatePersistedDetailString(
  value: string,
  maxChars = MAX_PERSISTED_DETAIL_STRING_CHARS,
): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars)}\n\n[xopc persisted detail truncated: ${
    value.length - maxChars
  } chars omitted]`;
}

function sanitizePersistedSessionDetail(value: unknown): unknown {
  if (!value || typeof value !== 'object') {
    return value;
  }
  const src = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of [
    'sessionId',
    'status',
    'pid',
    'startedAt',
    'endedAt',
    'runtimeMs',
    'cwd',
    'name',
    'truncated',
    'exitCode',
    'exitSignal',
  ]) {
    const field = src[key];
    if (field !== undefined) {
      out[key] = typeof field === 'string' ? truncatePersistedDetailString(field, 500) : field;
    }
  }
  if (typeof src.command === 'string') {
    out.command = truncatePersistedDetailString(src.command, 500);
  }
  return out;
}

function buildPersistedDetailsFallback(
  src: Record<string, unknown> | undefined,
  originalSize: BoundedJsonUtf8Bytes,
  sanitizedBytes?: number,
): Record<string, unknown> {
  const fallback: Record<string, unknown> = {
    persistedDetailsTruncated: true,
    finalDetailsTruncated: true,
    ...originalDetailsSizeFields(originalSize),
  };
  if (sanitizedBytes !== undefined) {
    fallback.sanitizedDetailsBytes = sanitizedBytes;
  }
  if (src) {
    fallback.originalDetailKeys = firstEnumerableOwnKeys(src, 40);
    for (const key of ['status', 'sessionId', 'pid', 'exitCode', 'exitSignal', 'truncated']) {
      const field = src[key];
      if (field !== undefined) {
        fallback[key] =
          typeof field === 'string'
            ? truncatePersistedDetailString(field, MAX_PERSISTED_DETAIL_FALLBACK_STRING_CHARS)
            : field;
      }
    }
  }
  return fallback;
}

function enforcePersistedDetailsByteCap(
  value: Record<string, unknown>,
  src: Record<string, unknown> | undefined,
  originalSize: BoundedJsonUtf8Bytes,
): Record<string, unknown> {
  const sanitizedBytes = jsonUtf8BytesOrInfinity(value);
  if (sanitizedBytes <= MAX_PERSISTED_TOOL_RESULT_DETAILS_BYTES) {
    return value;
  }
  const fallback = buildPersistedDetailsFallback(src, originalSize, sanitizedBytes);
  if (jsonUtf8BytesOrInfinity(fallback) <= MAX_PERSISTED_TOOL_RESULT_DETAILS_BYTES) {
    return fallback;
  }
  return {
    persistedDetailsTruncated: true,
    finalDetailsTruncated: true,
    ...originalDetailsSizeFields(originalSize),
    sanitizedDetailsBytes: sanitizedBytes,
  };
}

function sanitizeToolResultDetailsForPersistence(details: unknown): unknown {
  if (details === undefined || details === null) {
    return details;
  }
  const originalSize = boundedJsonUtf8Bytes(details, MAX_PERSISTED_TOOL_RESULT_DETAILS_BYTES);
  if (originalSize.complete && originalSize.bytes <= MAX_PERSISTED_TOOL_RESULT_DETAILS_BYTES) {
    return details;
  }
  if (typeof details !== 'object') {
    return enforcePersistedDetailsByteCap(
      {
        persistedDetailsTruncated: true,
        ...originalDetailsSizeFields(originalSize),
        valueType: typeof details,
      },
      undefined,
      originalSize,
    );
  }
  const src = details as Record<string, unknown>;
  const out: Record<string, unknown> = {
    persistedDetailsTruncated: true,
    ...originalDetailsSizeFields(originalSize),
    originalDetailKeys: firstEnumerableOwnKeys(src, 40),
  };
  for (const key of [
    'status',
    'sessionId',
    'pid',
    'startedAt',
    'endedAt',
    'cwd',
    'name',
    'exitCode',
    'exitSignal',
    'retryInMs',
    'total',
    'totalLines',
    'totalChars',
    'truncated',
    'fullOutputPath',
    'truncation',
  ]) {
    const field = src[key];
    if (field !== undefined) {
      out[key] = typeof field === 'string' ? truncatePersistedDetailString(field) : field;
    }
  }
  if (typeof src.tail === 'string') {
    out.tail = truncatePersistedDetailString(src.tail);
  }
  if (Array.isArray(src.sessions)) {
    out.sessions = src.sessions
      .slice(0, MAX_PERSISTED_DETAIL_SESSION_COUNT)
      .map(sanitizePersistedSessionDetail);
    if (src.sessions.length > MAX_PERSISTED_DETAIL_SESSION_COUNT) {
      out.sessionsTruncated = src.sessions.length - MAX_PERSISTED_DETAIL_SESSION_COUNT;
    }
  }
  return enforcePersistedDetailsByteCap(out, src, originalSize);
}

function capToolResultDetails(msg: AgentMessage): AgentMessage {
  if ((msg as { role?: string }).role !== 'toolResult') {
    return msg;
  }
  const details = (msg as { details?: unknown }).details;
  const sanitizedDetails = sanitizeToolResultDetailsForPersistence(details);
  if (sanitizedDetails === details) {
    return msg;
  }
  const next = { ...msg } as AgentMessage & { details?: unknown };
  next.details = sanitizedDetails;
  return next;
}

function capToolResultForPersistence(msg: AgentMessage, maxChars: number): AgentMessage {
  return capToolResultDetails(capToolResultSize(msg, maxChars));
}

function normalizePersistedToolResultName(
  message: AgentMessage,
  fallbackName?: string,
): AgentMessage {
  if ((message as { role?: unknown }).role !== 'toolResult') {
    return message;
  }
  const toolResult = message as Extract<AgentMessage, { role: 'toolResult' }>;
  const rawToolName = (toolResult as { toolName?: unknown }).toolName;
  const normalizedToolName = normalizeOptionalString(rawToolName);
  if (normalizedToolName) {
    if (rawToolName === normalizedToolName) {
      return toolResult;
    }
    return { ...toolResult, toolName: normalizedToolName };
  }

  const normalizedFallback = normalizeOptionalString(fallbackName);
  if (normalizedFallback) {
    return { ...toolResult, toolName: normalizedFallback };
  }

  if (typeof rawToolName === 'string') {
    return { ...toolResult, toolName: 'unknown' };
  }
  return toolResult;
}

// ── Internal: raw-append symbol storage ─────────────────────────────────────

const RAW_APPEND_MESSAGE = Symbol('xopc.session.rawAppendMessage');

type SessionManagerWithRawAppend = SessionManager & {
  [RAW_APPEND_MESSAGE]?: SessionManager['appendMessage'];
};

function rememberOriginalAppend(
  sessionManager: SessionManager,
): SessionManager['appendMessage'] {
  const tagged = sessionManager as SessionManagerWithRawAppend;
  const stored = tagged[RAW_APPEND_MESSAGE];
  if (stored) {
    return stored;
  }
  const original = sessionManager.appendMessage.bind(sessionManager);
  tagged[RAW_APPEND_MESSAGE] = original;
  return original;
}

// ── Internal: pending tool-call state ──────────────────────────────────────

type PendingToolCall = { id: string; name?: string };

class PendingToolCallTracker {
  private readonly pending = new Map<string, string | undefined>();

  size(): number {
    return this.pending.size;
  }

  getToolName(id: string): string | undefined {
    return this.pending.get(id);
  }

  delete(id: string): void {
    this.pending.delete(id);
  }

  clear(): void {
    this.pending.clear();
  }

  trackToolCalls(calls: readonly PendingToolCall[]): void {
    for (const call of calls) {
      this.pending.set(call.id, call.name);
    }
  }

  entries(): IterableIterator<[string, string | undefined]> {
    return this.pending.entries();
  }

  getPendingIds(): string[] {
    return Array.from(this.pending.keys());
  }

  shouldFlushForSanitizedDrop(): boolean {
    return this.pending.size > 0;
  }

  shouldFlushBeforeNonToolResult(nextRole: unknown, toolCallCount: number): boolean {
    return this.pending.size > 0 && (toolCallCount === 0 || nextRole !== 'assistant');
  }

  shouldFlushBeforeNewToolCalls(toolCallCount: number): boolean {
    return this.pending.size > 0 && toolCallCount > 0;
  }
}

// ── ToolResultGuard class ──────────────────────────────────────────────────

class ToolResultGuard {
  private readonly sessionManager: SessionManager;
  private readonly opts: ToolResultGuardOptions;
  private readonly pending = new PendingToolCallTracker();
  private readonly originalAppend: SessionManager['appendMessage'];
  private readonly allowSyntheticToolResults: boolean;
  private readonly maxToolResultChars: number;

  constructor(sessionManager: SessionManager, opts: ToolResultGuardOptions) {
    this.sessionManager = sessionManager;
    this.opts = opts;
    this.originalAppend = rememberOriginalAppend(sessionManager);
    this.allowSyntheticToolResults = opts.allowSyntheticToolResults ?? true;
    this.maxToolResultChars = resolveMaxToolResultChars(opts);
  }

  /** Monkey-patch the session manager so pi-coding-agent's internal appendMessage flows through us. */
  attach(): void {
    const bound = this.guardedAppend.bind(this);
    this.sessionManager.appendMessage = bound as SessionManager['appendMessage'];
  }

  flushPending(): void {
    if (this.pending.size() === 0) {
      return;
    }
    if (this.allowSyntheticToolResults) {
      for (const [id, name] of this.pending.entries()) {
        const synthetic = makeMissingToolResult({
          toolCallId: id,
          toolName: name,
          text: this.opts.missingToolResultText,
        });
        const flushed = this.applyBeforeWriteHook(
          this.persistToolResult(this.persistMessage(synthetic), {
            toolCallId: id,
            toolName: name,
            isSynthetic: true,
          }),
        );
        if (flushed) {
          this.originalAppend(capToolResultForPersistence(flushed, this.maxToolResultChars) as never);
        }
      }
    }
    this.pending.clear();
  }

  clearPending(): void {
    this.pending.clear();
  }

  getPendingIds(): string[] {
    return this.pending.getPendingIds();
  }

  private persistMessage(message: AgentMessage): AgentMessage {
    const transformer = this.opts.transformMessageForPersistence;
    return transformer ? transformer(message) : message;
  }

  private persistToolResult(
    message: AgentMessage,
    meta: { toolCallId?: string; toolName?: string; isSynthetic?: boolean },
  ): AgentMessage {
    const transformer = this.opts.transformToolResultForPersistence;
    return transformer ? transformer(message, meta) : message;
  }

  /**
   * Run the before_message_write hook. Returns the (possibly modified) message,
   * or null if the message should be blocked.
   */
  private applyBeforeWriteHook(msg: AgentMessage): AgentMessage | null {
    const beforeWrite = this.opts.beforeMessageWriteHook;
    if (!beforeWrite) {
      return msg;
    }
    const result = beforeWrite({ message: msg });
    if (result?.block) {
      return null;
    }
    if (result?.message) {
      return result.message;
    }
    return msg;
  }

  private guardedAppend(message: AgentMessage): unknown {
    let nextMessage = message;
    const role = (message as { role?: unknown }).role;
    if (role === 'assistant') {
      const sanitized = sanitizeToolCallInputs([message], {
        allowedToolNames: this.opts.allowedToolNames,
      });
      if (sanitized.length === 0) {
        if (this.pending.shouldFlushForSanitizedDrop()) {
          this.flushPending();
        }
        return undefined;
      }
      nextMessage = sanitized[0];
    }
    const nextRole = (nextMessage as { role?: unknown }).role;

    if (nextRole === 'toolResult') {
      const id = extractToolResultId(nextMessage as Extract<AgentMessage, { role: 'toolResult' }>);
      const toolName = id ? this.pending.getToolName(id) : undefined;
      if (id) {
        this.pending.delete(id);
      }
      const normalizedToolResult = normalizePersistedToolResultName(nextMessage, toolName);
      // Apply hard size cap before persistence to prevent oversized tool results
      // from consuming the entire context window on subsequent LLM calls.
      const capped = capToolResultForPersistence(
        this.persistMessage(normalizedToolResult),
        this.maxToolResultChars,
      );
      const persisted = this.applyBeforeWriteHook(
        this.persistToolResult(capped, {
          toolCallId: id ?? undefined,
          toolName,
          isSynthetic: false,
        }),
      );
      if (!persisted) {
        return undefined;
      }
      return this.originalAppend(capToolResultForPersistence(persisted, this.maxToolResultChars) as never);
    }

    // Skip tool call extraction for aborted/errored assistant messages.
    // When stopReason is "error" or "aborted", the tool_use blocks may be incomplete
    // and should not have synthetic tool_results created. Creating synthetic results
    // for incomplete tool calls causes API 400 errors:
    // "unexpected tool_use_id found in tool_result blocks"
    // This matches the behavior in repairToolUseResultPairing (session-transcript-repair.ts)
    const stopReason = (nextMessage as { stopReason?: string }).stopReason;
    const toolCalls =
      nextRole === 'assistant' && stopReason !== 'aborted' && stopReason !== 'error'
        ? extractToolCallsFromAssistant(nextMessage as Extract<AgentMessage, { role: 'assistant' }>)
        : [];

    // Always clear pending tool call state before appending non-tool-result messages.
    // flushPendingToolResults() only inserts synthetic results when allowSyntheticToolResults
    // is true; it always clears the pending map. Without this, providers that disable
    // synthetic results (e.g. OpenAI) accumulate stale pending state when a user message
    // interrupts in-flight tool calls, leaving orphaned tool_use blocks in the transcript
    // that cause API 400 errors on subsequent requests.
    if (this.pending.shouldFlushBeforeNonToolResult(nextRole, toolCalls.length)) {
      this.flushPending();
    }
    // If new tool calls arrive while older ones are pending, flush the old ones first.
    if (this.pending.shouldFlushBeforeNewToolCalls(toolCalls.length)) {
      this.flushPending();
    }

    const finalMessage = this.applyBeforeWriteHook(this.persistMessage(nextMessage));
    if (!finalMessage) {
      return undefined;
    }
    const result = this.originalAppend(finalMessage as never);

    const sessionFile = (
      this.sessionManager as { getSessionFile?: () => string | null }
    ).getSessionFile?.();
    if (sessionFile) {
      emitSessionTranscriptUpdate({
        sessionFile,
        sessionKey: this.opts.sessionKey,
        message: finalMessage,
        messageId: typeof result === 'string' ? result : undefined,
      });
    }

    if (toolCalls.length > 0) {
      this.pending.trackToolCalls(toolCalls);
    }

    return result;
  }
}
