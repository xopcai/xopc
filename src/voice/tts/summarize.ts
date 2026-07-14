import { complete, type UserMessage } from '@earendil-works/pi-ai/compat';
import type { Api, Model } from '@earendil-works/pi-ai';

import type { Config } from '../../config/schema.js';
import { getDefaultModelSync, resolveModel } from '../../providers/index.js';
import { createLogger } from '../../utils/logger.js';
import { truncateAtSentenceBoundary } from './sentence-boundary.js';

const log = createLogger('TTS:Summarize');

const SUMMARIZE_TIMEOUT_MS = 45_000;

const SUMMARIZE_SYSTEM_PROMPT = `You are a text summarizer for a text-to-speech system.
Your task is to condense the given text while preserving the key information and meaning.

Rules:
1. Output ONLY the summarized text, no explanations or meta-commentary
2. Keep the summary in the same language as the input
3. Preserve key facts, numbers, names, and conclusions
4. Use natural, spoken language suitable for audio playback
5. Remove code blocks, URLs, markdown formatting, and technical syntax where possible
6. Keep the summary under the specified character limit
7. End with a complete sentence, never mid-sentence`;

export interface SummarizeForTtsOptions {
  text: string;
  targetLength: number;
  config?: Config;
  modelRef?: string;
  signal?: AbortSignal;
}

export interface SummarizeResult {
  summary: string;
  originalLength: number;
  summaryLength: number;
  wasSummarized: boolean;
}

function resolveSummarizeModel(config: Config | undefined, modelRef?: string): Model<Api> {
  const envRef = process.env.XOPC_TTS_SUMMARIZE_MODEL?.trim();
  const ref = modelRef?.trim() || envRef;
  if (ref) {
    try {
      return resolveModel(ref);
    } catch {
      /* fall through */
    }
  }
  for (const candidate of ['openai/gpt-5.6-luna', 'google/gemini-3.5-flash']) {
    try {
      return resolveModel(candidate);
    } catch {
      /* next */
    }
  }
  return resolveModel(getDefaultModelSync(config));
}

function fallbackTruncate(text: string, maxLength: number): SummarizeResult {
  const truncated = truncateAtSentenceBoundary(text, maxLength);
  return {
    summary: truncated,
    originalLength: text.length,
    summaryLength: truncated.length,
    wasSummarized: false,
  };
}

/**
 * Condense text for TTS using a small LLM pass; falls back to sentence-boundary truncation.
 */
export async function summarizeForTts(options: SummarizeForTtsOptions): Promise<SummarizeResult> {
  const { text, targetLength, config, modelRef, signal } = options;

  if (text.length <= targetLength) {
    return {
      summary: text,
      originalLength: text.length,
      summaryLength: text.length,
      wasSummarized: false,
    };
  }

  const startTime = Date.now();

  try {
    const model = resolveSummarizeModel(config, modelRef);
    const userPrompt = [
      `Summarize the following text to fit within ${targetLength} characters.`,
      `The summary will be read aloud by a text-to-speech system, so use natural spoken language.`,
      '',
      '---',
      '',
      text,
    ].join('\n');

    const userMsg: UserMessage = {
      role: 'user',
      content: `${SUMMARIZE_SYSTEM_PROMPT}\n\n---\n\n${userPrompt}`,
      timestamp: Date.now(),
    };

    const timeoutSignal =
      typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
        ? AbortSignal.timeout(SUMMARIZE_TIMEOUT_MS)
        : undefined;
    const mergedSignal =
      signal && timeoutSignal && typeof AbortSignal.any === 'function'
        ? AbortSignal.any([signal, timeoutSignal])
        : signal ?? timeoutSignal;

    const result = await complete(
      model,
      { messages: [userMsg] },
      {
        maxTokens: Math.min(Math.ceil(targetLength / 2), 4096),
        temperature: 0.3,
        signal: mergedSignal as AbortSignal,
      },
    );

    let out = '';
    if (Array.isArray(result.content)) {
      for (const c of result.content) {
        if (c && typeof c === 'object' && (c as { type?: string }).type === 'text') {
          out += String((c as { text?: string }).text || '');
        }
      }
    }

    const summary = out.trim();
    if (!summary) {
      log.warn('Empty summary returned, falling back to truncation');
      return fallbackTruncate(text, targetLength);
    }

    const finalSummary =
      summary.length > targetLength ? truncateAtSentenceBoundary(summary, targetLength) : summary;

    log.info(
      {
        originalLength: text.length,
        summaryLength: finalSummary.length,
        durationMs: Date.now() - startTime,
      },
      'Text summarized for TTS',
    );

    return {
      summary: finalSummary,
      originalLength: text.length,
      summaryLength: finalSummary.length,
      wasSummarized: true,
    };
  } catch (error) {
    const em = error instanceof Error ? error.message : String(error);
    log.warn({ errorMessage: em }, 'Summarization failed, falling back to truncation');
    return fallbackTruncate(text, targetLength);
  }
}
