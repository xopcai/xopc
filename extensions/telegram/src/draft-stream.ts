/**
 * Telegram draft stream for streaming message previews (aligned with OpenClaw draft-stream).
 *
 * Uses sendMessage + editMessageText, or sendMessageDraft when available (DM / supported clients),
 * with automatic fallback and optional materialize for draft transport.
 */

import type { Bot } from 'grammy';
import { createLogger } from '@xopcai/xopcbot/utils/logger.js';
import type { ProgressStage } from '@xopcai/xopcbot/agent/progress.js';
import { createFinalizableDraftLifecycle } from './draft-stream-lifecycle.js';
import {
  isSafeToRetrySendError,
  isTelegramClientRejection,
  isTelegramThreadNotFoundError,
  shouldFallbackFromDraftTransport,
} from './telegram-draft-errors.js';
import { renderTelegramHtmlText, stripUnknownHtmlTags } from './format.js';

const log = createLogger('DraftStream');

const TELEGRAM_STREAM_MAX_CHARS = 4096;
const DEFAULT_THROTTLE_MS = 1000;
const TELEGRAM_DRAFT_ID_MAX = 2_147_483_647;

const TELEGRAM_DRAFT_STREAM_STATE_KEY = Symbol.for('xopcbot.telegramDraftStreamState');

let draftStreamState: { nextDraftId: number } | undefined;

function getDraftStreamState(): { nextDraftId: number } {
  draftStreamState ??= { nextDraftId: 0 };
  return draftStreamState;
}

function allocateTelegramDraftId(): number {
  const state = getDraftStreamState();
  state.nextDraftId = state.nextDraftId >= TELEGRAM_DRAFT_ID_MAX ? 1 : state.nextDraftId + 1;
  return state.nextDraftId;
}

type TelegramSendMessageDraft = (
  chatId: number | string,
  draftId: number,
  text: string,
  params?: {
    message_thread_id?: number;
    parse_mode?: 'HTML';
  },
) => Promise<unknown>;

function resolveSendMessageDraftApi(api: Bot['api']): TelegramSendMessageDraft | undefined {
  const sendMessageDraft = (api as Bot['api'] & { sendMessageDraft?: TelegramSendMessageDraft })
    .sendMessageDraft;
  if (typeof sendMessageDraft !== 'function') {
    return undefined;
  }
  return sendMessageDraft.bind(api as object);
}

const STAGE_CONFIG: Record<ProgressStage, { emoji: string; label: string }> = {
  thinking: { emoji: '🤔', label: 'Thinking' },
  searching: { emoji: '🔍', label: 'Searching' },
  reading: { emoji: '📖', label: 'Reading' },
  writing: { emoji: '✍️', label: 'Writing' },
  executing: { emoji: '⚙️', label: 'Executing' },
  analyzing: { emoji: '📊', label: 'Analyzing' },
  idle: { emoji: '💬', label: 'Ready' },
};

export type TelegramDraftPreview = {
  text: string;
  parseMode?: 'HTML';
};

export interface TelegramDraftStreamOptions {
  api: Bot['api'];
  chatId: number | string;
  maxChars?: number;
  threadId?: number;
  replyToMessageId?: number;
  throttleMs?: number;
  /** Prefer draft API, real message edits, or auto (DM → draft when API exists). */
  previewTransport?: 'auto' | 'message' | 'draft';
  /** Minimum chars before first outbound preview (push notification quality). */
  minInitialChars?: number;
  /** Optional preview renderer (e.g. markdown → HTML). */
  renderText?: (text: string) => TelegramDraftPreview;
  /** Called when a late send resolves after forceNewMessage() rotated generations. */
  onSupersededPreview?: (preview: {
    messageId: number;
    textSnapshot: string;
    parseMode?: 'HTML';
  }) => void;
  warn?: (message: string) => void;
  /** Legacy: force HTML path; prefer renderText instead. */
  parseMode?: 'Markdown' | 'HTML' | undefined;
  enableProgress?: boolean;
}

export interface TelegramDraftStream {
  update: (text: string) => void;
  updateWithProgress: (text: string, stage?: ProgressStage, detail?: string) => void;
  flush: () => Promise<void>;
  messageId: () => number | undefined;
  previewMode?: () => 'message' | 'draft';
  previewRevision?: () => number;
  lastDeliveredText?: () => string;
  clear: () => Promise<void>;
  stop: () => Promise<void>;
  materialize?: () => Promise<number | undefined>;
  forceNewMessage: () => void;
  sendMayHaveLanded?: () => boolean;
  setProgress: (stage: ProgressStage, detail?: string) => void;
}

function isProbablyPrivateChat(chatId: number | string): boolean {
  const n = typeof chatId === 'string' ? Number(chatId) : chatId;
  if (Number.isFinite(n) && n < 0) {
    return false;
  }
  return true;
}

function defaultRenderText(
  trimmed: string,
  parseMode: TelegramDraftStreamOptions['parseMode'],
): TelegramDraftPreview {
  if (parseMode === 'HTML') {
    return { text: stripUnknownHtmlTags(trimmed), parseMode: 'HTML' };
  }
  return {
    text: renderTelegramHtmlText(trimmed),
    parseMode: 'HTML',
  };
}

/**
 * Create a draft stream for streaming message previews.
 */
export function createTelegramDraftStream(options: TelegramDraftStreamOptions): TelegramDraftStream {
  const maxChars = Math.min(
    options.maxChars ?? TELEGRAM_STREAM_MAX_CHARS,
    TELEGRAM_STREAM_MAX_CHARS,
  );
  const throttleMs = Math.max(250, options.throttleMs ?? DEFAULT_THROTTLE_MS);
  const chatId = options.chatId;
  const requestedPreviewTransport = options.previewTransport ?? 'auto';
  const prefersDraftTransport =
    requestedPreviewTransport === 'draft'
      ? true
      : requestedPreviewTransport === 'message'
        ? false
        : isProbablyPrivateChat(chatId);
  const resolvedDraftApi = prefersDraftTransport ? resolveSendMessageDraftApi(options.api) : undefined;
  const usesDraftTransport = Boolean(prefersDraftTransport && resolvedDraftApi);
  if (prefersDraftTransport && !usesDraftTransport) {
    options.warn?.(
      'telegram stream preview: sendMessageDraft unavailable; falling back to sendMessage/editMessageText',
    );
  }

  const threadParams: Record<string, number> = {};
  if (options.threadId != null) {
    threadParams.message_thread_id = options.threadId;
  }
  if (options.replyToMessageId != null) {
    threadParams.reply_to_message_id = options.replyToMessageId;
  }

  const replyParams = { ...threadParams };

  const streamState = { stopped: false, final: false };
  let messageSendAttempted = false;
  let streamMessageId: number | undefined;
  let streamDraftId = usesDraftTransport ? allocateTelegramDraftId() : undefined;
  let previewTransport: 'message' | 'draft' = usesDraftTransport ? 'draft' : 'message';
  let lastSentText = '';
  let lastDeliveredText = '';
  let lastSentParseMode: 'HTML' | undefined;
  let previewRevision = 0;
  let generation = 0;

  const minInitialChars = options.minInitialChars;

  const renderPreview = (trimmed: string): TelegramDraftPreview => {
    if (options.renderText) {
      return options.renderText(trimmed);
    }
    return defaultRenderText(trimmed, options.parseMode);
  };

  const sendRenderedMessageWithThreadFallback = async (sendArgs: {
    renderedText: string;
    renderedParseMode: 'HTML' | undefined;
    fallbackWarnMessage: string;
  }) => {
    const sendParams = sendArgs.renderedParseMode
      ? { ...replyParams, parse_mode: sendArgs.renderedParseMode }
      : replyParams;
    const usedThreadParams =
      'message_thread_id' in (sendParams ?? {}) &&
      typeof (sendParams as { message_thread_id?: unknown }).message_thread_id === 'number';
    try {
      return {
        sent: await options.api.sendMessage(chatId, sendArgs.renderedText, sendParams),
        usedThreadParams,
      };
    } catch (err) {
      if (!usedThreadParams || !isTelegramThreadNotFoundError(err)) {
        throw err;
      }
      const threadlessParams = { ...(sendParams as Record<string, unknown>) };
      delete threadlessParams.message_thread_id;
      options.warn?.(sendArgs.fallbackWarnMessage);
      return {
        sent: await options.api.sendMessage(
          chatId,
          sendArgs.renderedText,
          Object.keys(threadlessParams).length > 0 ? threadlessParams : undefined,
        ),
        usedThreadParams: false,
      };
    }
  };

  type PreviewSendParams = {
    renderedText: string;
    renderedParseMode: 'HTML' | undefined;
    sendGeneration: number;
  };

  const sendMessageTransportPreview = async ({
    renderedText,
    renderedParseMode,
    sendGeneration,
  }: PreviewSendParams): Promise<boolean> => {
    if (typeof streamMessageId === 'number') {
      if (renderedParseMode) {
        await options.api.editMessageText(chatId, streamMessageId, renderedText, {
          parse_mode: renderedParseMode,
        });
      } else {
        await options.api.editMessageText(chatId, streamMessageId, renderedText);
      }
      return true;
    }
    messageSendAttempted = true;
    let sent: Awaited<ReturnType<typeof sendRenderedMessageWithThreadFallback>>['sent'];
    try {
      ({ sent } = await sendRenderedMessageWithThreadFallback({
        renderedText,
        renderedParseMode,
        fallbackWarnMessage:
          'telegram stream preview send failed with message_thread_id, retrying without thread',
      }));
    } catch (err) {
      if (isSafeToRetrySendError(err) || isTelegramClientRejection(err)) {
        messageSendAttempted = false;
      }
      throw err;
    }
    const sentMessageId = sent?.message_id;
    if (typeof sentMessageId !== 'number' || !Number.isFinite(sentMessageId)) {
      streamState.stopped = true;
      options.warn?.('telegram stream preview stopped (missing message id from sendMessage)');
      return false;
    }
    const normalizedMessageId = Math.trunc(sentMessageId);
    if (sendGeneration !== generation) {
      options.onSupersededPreview?.({
        messageId: normalizedMessageId,
        textSnapshot: renderedText,
        parseMode: renderedParseMode,
      });
      return true;
    }
    streamMessageId = normalizedMessageId;
    return true;
  };

  const sendDraftTransportPreview = async ({
    renderedText,
    renderedParseMode,
  }: PreviewSendParams): Promise<boolean> => {
    const draftId = streamDraftId ?? allocateTelegramDraftId();
    streamDraftId = draftId;
    const draftParams = {
      ...(threadParams.message_thread_id != null
        ? { message_thread_id: threadParams.message_thread_id }
        : {}),
      ...(renderedParseMode ? { parse_mode: renderedParseMode } : {}),
    };
    await resolvedDraftApi!(
      chatId,
      draftId,
      renderedText,
      Object.keys(draftParams).length > 0 ? draftParams : undefined,
    );
    return true;
  };

  const sendOrEditStreamMessage = async (text: string): Promise<boolean> => {
    if (streamState.stopped && !streamState.final) {
      return false;
    }
    const trimmed = text.trimEnd();
    if (!trimmed) {
      return false;
    }
    const rendered = renderPreview(trimmed);
    const renderedText = rendered.text.trimEnd();
    const renderedParseMode = rendered.parseMode;
    if (!renderedText) {
      return false;
    }
    if (renderedText.length > maxChars) {
      streamState.stopped = true;
      options.warn?.(
        `telegram stream preview stopped (text length ${renderedText.length} > ${maxChars})`,
      );
      return false;
    }
    if (renderedText === lastSentText && renderedParseMode === lastSentParseMode) {
      return true;
    }
    const sendGeneration = generation;

    if (typeof streamMessageId !== 'number' && minInitialChars != null && !streamState.final) {
      if (renderedText.length < minInitialChars) {
        return false;
      }
    }

    lastSentText = renderedText;
    lastSentParseMode = renderedParseMode;
    try {
      let sent = false;
      if (previewTransport === 'draft') {
        try {
          sent = await sendDraftTransportPreview({
            renderedText,
            renderedParseMode,
            sendGeneration,
          });
        } catch (err) {
          if (!shouldFallbackFromDraftTransport(err)) {
            throw err;
          }
          previewTransport = 'message';
          streamDraftId = undefined;
          options.warn?.(
            'telegram stream preview: sendMessageDraft rejected by API; falling back to sendMessage/editMessageText',
          );
          sent = await sendMessageTransportPreview({
            renderedText,
            renderedParseMode,
            sendGeneration,
          });
        }
      } else {
        sent = await sendMessageTransportPreview({
          renderedText,
          renderedParseMode,
          sendGeneration,
        });
      }
      if (sent) {
        previewRevision += 1;
        lastDeliveredText = trimmed;
      }
      return sent;
    } catch (err) {
      streamState.stopped = true;
      options.warn?.(
        `telegram stream preview failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  };

  const { loop, update, stop, clear } = createFinalizableDraftLifecycle({
    throttleMs,
    state: streamState,
    sendOrEditStreamMessage,
    readMessageId: () => streamMessageId,
    clearMessageId: () => {
      streamMessageId = undefined;
    },
    isValidMessageId: (value): value is number =>
      typeof value === 'number' && Number.isFinite(value),
    deleteMessage: async (messageId) => {
      await options.api.deleteMessage(chatId, messageId);
    },
    onDeleteSuccess: (messageId) => {
      log.debug({ chatId, messageId }, 'telegram stream preview deleted');
    },
    warn: (m) => options.warn?.(m),
    warnPrefix: 'telegram stream preview cleanup failed',
  });

  const forceNewMessage = () => {
    streamState.final = false;
    streamState.stopped = false;
    generation += 1;
    messageSendAttempted = false;
    streamMessageId = undefined;
    if (previewTransport === 'draft') {
      streamDraftId = allocateTelegramDraftId();
    }
    lastSentText = '';
    lastSentParseMode = undefined;
    loop.resetPending();
    loop.resetThrottleWindow();
  };

  const materialize = async (): Promise<number | undefined> => {
    await stop();
    if (previewTransport === 'message' && typeof streamMessageId === 'number') {
      return streamMessageId;
    }
    const renderedText = lastSentText || lastDeliveredText;
    if (!renderedText) {
      return undefined;
    }
    const renderedParseMode = lastSentText ? lastSentParseMode : undefined;
    try {
      const { sent, usedThreadParams } = await sendRenderedMessageWithThreadFallback({
        renderedText,
        renderedParseMode,
        fallbackWarnMessage:
          'telegram stream preview materialize send failed with message_thread_id, retrying without thread',
      });
      const sentId = sent?.message_id;
      if (typeof sentId === 'number' && Number.isFinite(sentId)) {
        streamMessageId = Math.trunc(sentId);
        if (resolvedDraftApi != null && streamDraftId != null) {
          const clearDraftId = streamDraftId;
          const clearThreadParams =
            usedThreadParams && threadParams.message_thread_id != null
              ? { message_thread_id: threadParams.message_thread_id }
              : undefined;
          try {
            await resolvedDraftApi(chatId, clearDraftId, '', clearThreadParams);
          } catch {
            // Best-effort cleanup
          }
        }
        return streamMessageId;
      }
    } catch (err) {
      options.warn?.(
        `telegram stream preview materialize failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return undefined;
  };

  let currentProgressStage: ProgressStage | null = null;
  let currentProgressDetail = '';

  const setProgress = (stage: ProgressStage, detail?: string) => {
    if (!options.enableProgress) return;
    currentProgressStage = stage;
    currentProgressDetail = detail || '';
  };

  const formatProgressIndicator = (stage: ProgressStage, detail?: string): string => {
    const config = STAGE_CONFIG[stage] || STAGE_CONFIG.idle;
    let indicator = `${config.emoji} ${config.label}`;
    if (detail) {
      indicator += `\n${detail}`;
    }
    return indicator;
  };

  const updateWithProgress = (text: string, stage?: ProgressStage, detail?: string) => {
    if (streamState.stopped || streamState.final) {
      return;
    }
    if (stage) {
      setProgress(stage, detail);
    }
    let combinedText = text;
    if (options.enableProgress && currentProgressStage && currentProgressStage !== 'idle') {
      const indicator = formatProgressIndicator(currentProgressStage, currentProgressDetail);
      combinedText = `${indicator}\n\n${text}`;
    }
    update(combinedText);
  };

  log.debug({ chatId, maxChars, throttleMs, previewTransport }, 'Draft stream ready');

  return {
    update,
    updateWithProgress,
    flush: loop.flush,
    messageId: () => streamMessageId,
    previewMode: () => previewTransport,
    previewRevision: () => previewRevision,
    lastDeliveredText: () => lastDeliveredText,
    clear,
    stop,
    materialize,
    forceNewMessage,
    sendMayHaveLanded: () => messageSendAttempted && typeof streamMessageId !== 'number',
    setProgress,
  };
}

export class DraftStreamManager {
  private streams = new Map<string, TelegramDraftStream>();

  getOrCreate(key: string, options: TelegramDraftStreamOptions): TelegramDraftStream {
    const existing = this.streams.get(key);
    if (existing) {
      return existing;
    }

    const stream = createTelegramDraftStream(options);
    this.streams.set(key, stream);

    const originalStop = stream.stop;
    stream.stop = async () => {
      await originalStop.call(stream);
      this.streams.delete(key);
    };

    return stream;
  }

  get(key: string): TelegramDraftStream | undefined {
    return this.streams.get(key);
  }

  async stop(key: string): Promise<void> {
    const stream = this.streams.get(key);
    if (stream) {
      await stream.flush();
      await stream.stop();
      this.streams.delete(key);
    }
  }

  async stopAll(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const [key, stream] of this.streams.entries()) {
      promises.push(
        (async () => {
          await stream.flush();
          await stream.stop();
          this.streams.delete(key);
        })(),
      );
    }
    await Promise.all(promises);
  }

  async clear(key: string): Promise<void> {
    const stream = this.streams.get(key);
    if (stream) {
      await stream.clear();
    }
  }
}

export const draftStreamManager = new DraftStreamManager();

export const __testing = {
  resetTelegramDraftStreamForTests() {
    getDraftStreamState().nextDraftId = 0;
  },
};
