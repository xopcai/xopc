import { createHash } from 'node:crypto';

import type { UserMessage } from '@earendil-works/pi-ai/compat';
import { z } from 'zod';

import type { Config } from '../config/schema.js';
import { getAgentDefaultModelRef } from '../config/schema.js';
import { resolveModel } from '../providers/index.js';
import { completeWithResolvedCredentials } from '../providers/model-call.js';

import type { DiscussionAnalysis } from './types.js';

const MAX_TRANSCRIPT_CHARS = 120_000;

const AnalysisSchema = z.object({
  summary: z.string().trim().min(1).max(4_000),
  keyPoints: z.array(z.string().trim().min(1).max(1_000)).max(12).default([]),
  decisions: z.array(z.string().trim().min(1).max(1_000)).max(12).default([]),
  actionItems: z.array(z.object({
    id: z.string().trim().min(1).max(100).optional(),
    title: z.string().trim().min(1).max(500),
    owner: z.string().trim().min(1).max(200).optional(),
    dueDate: z.string().trim().min(1).max(100).optional(),
  })).max(20).default([]),
  risks: z.array(z.string().trim().min(1).max(1_000)).max(12).default([]),
  openQuestions: z.array(z.string().trim().min(1).max(1_000)).max(12).default([]),
});

function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((part) => {
    if (!part || typeof part !== 'object') return '';
    const value = part as { type?: unknown; text?: unknown };
    return value.type === 'text' && typeof value.text === 'string' ? value.text : '';
  }).join('');
}

function parseJsonObject(raw: string): unknown {
  const stripped = raw.trim().replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  try {
    return JSON.parse(stripped) as unknown;
  } catch {
    const start = stripped.indexOf('{');
    const end = stripped.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('Discussion analysis did not return valid JSON');
    return JSON.parse(stripped.slice(start, end + 1)) as unknown;
  }
}

function actionId(title: string, index: number): string {
  return createHash('sha256').update(`${index}:${title}`).digest('hex').slice(0, 16);
}

export function normalizeDiscussionAnalysis(value: unknown): DiscussionAnalysis {
  const parsed = AnalysisSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Invalid discussion analysis: ${parsed.error.issues[0]?.message ?? 'schema mismatch'}`);
  }
  return {
    ...parsed.data,
    actionItems: parsed.data.actionItems.map((item, index) => ({
      id: item.id ?? actionId(item.title, index),
      title: item.title,
      ...(item.owner ? { owner: item.owner } : {}),
      ...(item.dueDate ? { dueDate: item.dueDate } : {}),
    })),
  };
}

export async function analyzeDiscussion(input: {
  config: Config;
  transcript: string;
  languageHint?: string;
  signal?: AbortSignal;
}): Promise<{ analysis: DiscussionAnalysis; modelRef: string }> {
  const modelRef = getAgentDefaultModelRef(input.config);
  if (!modelRef) throw new Error('No default model configured for discussion analysis');
  const transcript = input.transcript.trim().slice(0, MAX_TRANSCRIPT_CHARS);
  if (!transcript) throw new Error('Discussion transcript is empty');

  const prompt = [
    'Analyze the supplied workplace discussion transcript.',
    'Use only facts explicitly present in the transcript. Do not invent owners, dates, decisions, or commitments.',
    'Return exactly one JSON object with: summary, keyPoints, decisions, actionItems, risks, openQuestions.',
    'actionItems contains title and optional owner and dueDate. Omit owner or dueDate when not explicit.',
    'Keep unresolved possibilities in openQuestions, not decisions.',
    `Use ${input.languageHint === 'en' ? 'English' : input.languageHint === 'zh' ? 'Simplified Chinese' : 'the main language of the transcript'} for every user-facing string.`,
    '',
    transcript,
  ].join('\n');
  const message: UserMessage = { role: 'user', content: prompt, timestamp: Date.now() };
  const response = await completeWithResolvedCredentials(
    resolveModel(modelRef),
    { messages: [message] },
    { maxTokens: 3_000, temperature: 0.1, signal: input.signal },
  );
  return {
    modelRef,
    analysis: normalizeDiscussionAnalysis(parseJsonObject(extractText(response.content))),
  };
}
