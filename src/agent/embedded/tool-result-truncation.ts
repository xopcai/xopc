import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { TextContent } from '@earendil-works/pi-ai';

import type { Config } from '../../config/schema.js';
import { normalizeLowercaseStringOrEmpty } from '../../utils/string-coerce.js';
import { formatContextLimitTruncationNotice } from './tool-result-context-guard.js';

const MAX_TOOL_RESULT_CONTEXT_SHARE = 0.3;

export const DEFAULT_MAX_LIVE_TOOL_RESULT_CHARS = 16_000;
export const HARD_MAX_TOOL_RESULT_CHARS = DEFAULT_MAX_LIVE_TOOL_RESULT_CHARS;

const MIN_KEEP_CHARS = 2_000;

type ToolResultTruncationOptions = {
  suffix?: string | ((truncatedChars: number) => string);
  minKeepChars?: number;
};

const DEFAULT_SUFFIX = (truncatedChars: number) => formatContextLimitTruncationNotice(truncatedChars);

function resolveSuffixFactory(
  suffix: ToolResultTruncationOptions['suffix'],
): (truncatedChars: number) => string {
  if (typeof suffix === 'function') {
    return suffix;
  }
  if (typeof suffix === 'string') {
    return () => suffix;
  }
  return DEFAULT_SUFFIX;
}

function resolveEffectiveMinKeepChars(params: {
  maxChars: number;
  minKeepChars: number;
  suffixFactory: (truncatedChars: number) => string;
}): number {
  const suffixFloor = params.suffixFactory(1).length;
  return Math.max(0, Math.min(params.minKeepChars, Math.max(0, params.maxChars - suffixFloor)));
}

function appendBoundedTruncationSuffix(params: {
  keptText: string;
  originalTextLength: number;
  maxChars: number;
  suffixFactory: (truncatedChars: number) => string;
}): string {
  const build = (keptText: string) =>
    keptText + params.suffixFactory(Math.max(1, params.originalTextLength - keptText.length));

  let keptText = params.keptText;
  while (true) {
    const finalText = build(keptText);
    if (finalText.length <= params.maxChars) {
      return finalText;
    }
    if (keptText.length === 0) {
      return finalText.slice(0, params.maxChars);
    }
    const overflow = finalText.length - params.maxChars;
    const nextKeptText = keptText.slice(0, Math.max(0, keptText.length - overflow));
    keptText = nextKeptText.length < keptText.length ? nextKeptText : keptText.slice(0, -1);
  }
}

const MIDDLE_OMISSION_MARKER =
  '\n\n[... middle content omitted — showing head and tail ...]\n\n';

function hasImportantTail(text: string): boolean {
  const tail = normalizeLowercaseStringOrEmpty(text.slice(-2000));
  return (
    /\b(error|exception|failed|fatal|traceback|panic|stack trace|errno|exit code)\b/.test(tail) ||
    /\}\s*$/.test(tail.trim()) ||
    /\b(total|summary|result|complete|finished|done)\b/.test(tail)
  );
}

export function truncateToolResultText(
  text: string,
  maxChars: number,
  options: ToolResultTruncationOptions = {},
): string {
  const suffixFactory = resolveSuffixFactory(options.suffix);
  const minKeepChars = resolveEffectiveMinKeepChars({
    maxChars,
    minKeepChars: options.minKeepChars ?? MIN_KEEP_CHARS,
    suffixFactory,
  });
  if (text.length <= maxChars) {
    return text;
  }
  const defaultSuffix = suffixFactory(Math.max(1, text.length - maxChars));
  const budget = Math.max(minKeepChars, maxChars - defaultSuffix.length);

  if (hasImportantTail(text) && budget > minKeepChars * 2) {
    const tailBudget = Math.min(Math.floor(budget * 0.3), 4_000);
    const headBudget = budget - tailBudget - MIDDLE_OMISSION_MARKER.length;

    if (headBudget > minKeepChars) {
      let headCut = headBudget;
      const headNewline = text.lastIndexOf('\n', headBudget);
      if (headNewline > headBudget * 0.8) {
        headCut = headNewline;
      }

      let tailStart = text.length - tailBudget;
      const tailNewline = text.indexOf('\n', tailStart);
      if (tailNewline !== -1 && tailNewline < tailStart + tailBudget * 0.2) {
        tailStart = tailNewline + 1;
      }

      const keptText = text.slice(0, headCut) + MIDDLE_OMISSION_MARKER + text.slice(tailStart);
      return appendBoundedTruncationSuffix({
        keptText,
        originalTextLength: text.length,
        maxChars,
        suffixFactory,
      });
    }
  }

  let cutPoint = budget;
  const lastNewline = text.lastIndexOf('\n', budget);
  if (lastNewline > budget * 0.8) {
    cutPoint = lastNewline;
  }
  const keptText = text.slice(0, cutPoint);
  return appendBoundedTruncationSuffix({
    keptText,
    originalTextLength: text.length,
    maxChars,
    suffixFactory,
  });
}

export function calculateMaxToolResultCharsWithCap(
  contextWindowTokens: number,
  hardCapChars: number,
): number {
  const maxTokens = Math.floor(contextWindowTokens * MAX_TOOL_RESULT_CONTEXT_SHARE);
  const maxChars = maxTokens * 4;
  return Math.min(maxChars, Math.max(1, hardCapChars));
}

export function resolveLiveToolResultMaxChars(params: {
  contextWindowTokens: number;
  cfg?: Config;
  agentId?: string | null;
}): number {
  const configuredCap = DEFAULT_MAX_LIVE_TOOL_RESULT_CHARS;
  return calculateMaxToolResultCharsWithCap(params.contextWindowTokens, configuredCap);
}

export function getToolResultTextLength(msg: AgentMessage): number {
  if (!msg || (msg as { role?: string }).role !== 'toolResult') {
    return 0;
  }
  const content = (msg as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return 0;
  }
  let totalLength = 0;
  for (const block of content) {
    if (block && typeof block === 'object' && (block as { type?: string }).type === 'text') {
      const text = (block as TextContent).text;
      if (typeof text === 'string') {
        totalLength += text.length;
      }
    }
  }
  return totalLength;
}

export function truncateToolResultMessage(
  msg: AgentMessage,
  maxChars: number,
  options: ToolResultTruncationOptions = {},
): AgentMessage {
  const suffixFactory = resolveSuffixFactory(options.suffix);
  const minKeepChars = resolveEffectiveMinKeepChars({
    maxChars,
    minKeepChars: options.minKeepChars ?? MIN_KEEP_CHARS,
    suffixFactory,
  });
  const content = (msg as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return msg;
  }

  const totalTextChars = getToolResultTextLength(msg);
  if (totalTextChars <= maxChars) {
    return msg;
  }

  const newContent = content.map((block: unknown) => {
    if (!block || typeof block !== 'object' || (block as { type?: string }).type !== 'text') {
      return block;
    }
    const textBlock = block as TextContent;
    if (typeof textBlock.text !== 'string') {
      return block;
    }
    const blockShare = textBlock.text.length / totalTextChars;
    const defaultSuffix = suffixFactory(
      Math.max(1, textBlock.text.length - Math.floor(maxChars * blockShare)),
    );
    const proportionalBudget = Math.floor(maxChars * blockShare);
    const blockBudget = Math.max(
      1,
      Math.min(maxChars, Math.max(minKeepChars + defaultSuffix.length, proportionalBudget)),
    );
    return Object.assign({}, textBlock, {
      text: truncateToolResultText(textBlock.text, blockBudget, {
        suffix: suffixFactory,
        minKeepChars,
      }),
    });
  });

  return { ...msg, content: newContent } as AgentMessage;
}
