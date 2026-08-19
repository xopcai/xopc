import { createHash } from 'node:crypto';

import type { UserMessage } from '@earendil-works/pi-ai/compat';
import { z } from 'zod';

import type { Config } from '../config/schema.js';
import { getAgentDefaultModelRef } from '../config/schema.js';
import { resolveModel } from '../providers/index.js';
import { completeWithResolvedCredentials } from '../providers/model-call.js';

import type { DiscussionOrganization } from './types.js';

const MAX_TRANSCRIPT_CHARS = 120_000;

const OrganizationSchema = z.object({
  title: z.string().trim().min(1).max(200),
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
  projectCandidateId: z.string().trim().min(1).max(200).optional(),
  projectConfidence: z.number().min(0).max(1).optional(),
  projectAlternativeConfidence: z.number().min(0).max(1).optional(),
});

const LiveEnrichmentSchema = z.object({
  title: z.string().trim().min(1).max(200),
  projectCandidateId: z.string().trim().min(1).max(200).optional(),
  projectConfidence: z.number().min(0).max(1).optional(),
  projectAlternativeConfidence: z.number().min(0).max(1).optional(),
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
    if (start < 0 || end <= start) throw new Error('Discussion organizer did not return valid JSON');
    return JSON.parse(stripped.slice(start, end + 1)) as unknown;
  }
}

function actionId(title: string, index: number): string {
  return createHash('sha256').update(`${index}:${title}`).digest('hex').slice(0, 16);
}

export function normalizeDiscussionOrganization(value: unknown): DiscussionOrganization {
  const parsed = OrganizationSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Invalid discussion organization: ${parsed.error.issues[0]?.message ?? 'schema mismatch'}`);
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
  projects?: Array<{ id: string; name: string }>;
  signal?: AbortSignal;
}): Promise<{ organization: DiscussionOrganization; modelRef: string }> {
  const modelRef = getAgentDefaultModelRef(input.config);
  if (!modelRef) throw new Error('No default model configured for discussion organization');
  const transcript = input.transcript.trim().slice(0, MAX_TRANSCRIPT_CHARS);
  if (!transcript) throw new Error('Discussion transcript is empty');

  const prompt = [
    'Organize the supplied workplace discussion transcript.',
    'Use only facts explicitly present in the transcript. Do not invent owners, dates, decisions, or commitments.',
    'Return exactly one JSON object with: title, summary, keyPoints, decisions, actionItems, risks, openQuestions, and optional projectCandidateId, projectConfidence, and projectAlternativeConfidence.',
    'title is a short concrete note title derived from the discussion.',
    'actionItems contains title and optional owner and dueDate. Omit owner or dueDate when not explicit.',
    'Keep unresolved possibilities in openQuestions, not decisions.',
    input.projects?.length
      ? `Choose projectCandidateId only from this catalog when the discussion clearly belongs to it; otherwise omit it. projectConfidence is the top probability and projectAlternativeConfidence is the runner-up probability: ${JSON.stringify(input.projects.slice(0, 100))}`
      : 'Omit projectCandidateId and projectConfidence.',
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
    organization: normalizeDiscussionOrganization(parseJsonObject(extractText(response.content))),
  };
}

export async function enrichLiveDiscussion(input: {
  config: Config;
  transcript: string;
  projects: Array<{ id: string; name: string }>;
  signal?: AbortSignal;
}): Promise<z.infer<typeof LiveEnrichmentSchema> & { modelRef: string }> {
  const modelRef = getAgentDefaultModelRef(input.config);
  if (!modelRef) throw new Error('No default model configured for discussion enrichment');
  const transcript = input.transcript.trim().slice(0, 12_000);
  if (!transcript) throw new Error('Discussion transcript is empty');
  const prompt = [
    'Create a short concrete note title for this partial workplace discussion transcript.',
    'Return exactly one JSON object with title and optional projectCandidateId, projectConfidence, and projectAlternativeConfidence.',
    'Choose a project only when the transcript clearly belongs to it. Never invent a project id.',
    `Project catalog: ${JSON.stringify(input.projects.slice(0, 100))}`,
    '',
    transcript,
  ].join('\n');
  const message: UserMessage = { role: 'user', content: prompt, timestamp: Date.now() };
  const response = await completeWithResolvedCredentials(
    resolveModel(modelRef),
    { messages: [message] },
    { maxTokens: 400, temperature: 0.1, signal: input.signal },
  );
  return {
    modelRef,
    ...LiveEnrichmentSchema.parse(parseJsonObject(extractText(response.content))),
  };
}
