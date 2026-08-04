import { randomUUID } from 'node:crypto';

import type { UserMessage } from '@earendil-works/pi-ai/compat';

import type { Config } from '../config/schema.js';
import { getAgentDefaultModelRef } from '../config/schema.js';
import { completeWithResolvedCredentials } from '../providers/model-call.js';
import { resolveModel } from '../providers/index.js';

import type {
  WorkContextSnapshot,
  WorkDiscoveryCandidate,
  WorkDiscoveryPersonalContextItem,
  WorkDiscoveryProfileCandidate,
  WorkDiscoveryResult,
  WorkDiscoverySuggestion,
  WorkUnderstandingThreadCandidate,
} from './types.js';

const MAX_MODEL_CONTEXT_CHARS = 120_000;
const MAX_PERSONAL_CONTEXT_CHARS = 100_000;
const WORK_ANALYSIS_MAX_TOKENS = 6_000;

function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((part) => {
    if (!part || typeof part !== 'object') return '';
    const value = part as { type?: unknown; text?: unknown };
    return value.type === 'text' && typeof value.text === 'string' ? value.text : '';
  }).join('');
}

function parseJson(raw: string): Record<string, unknown> | null {
  const candidates: string[] = [];
  for (const match of raw.matchAll(/```json\s*([\s\S]*?)```/gi)) {
    if (match[1]) candidates.push(match[1]);
  }
  candidates.push(raw.trim());
  for (const match of raw.matchAll(/```(?:[^\n]*)?\s*([\s\S]*?)```/g)) {
    if (match[1]) candidates.push(match[1]);
  }
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) candidates.push(raw.slice(start, end + 1));
  for (const candidate of new Set(candidates)) {
    try {
      const value = JSON.parse(candidate) as unknown;
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value as Record<string, unknown>;
      }
    } catch {
      // Try the next plausible response segment.
    }
  }
  return null;
}

function invalidJsonError(label: string, response: { stopReason?: unknown; errorMessage?: unknown }, raw: string): Error {
  const outputChars = raw.length;
  if (response.stopReason === 'length') {
    return new Error(`${label} response was truncated before completing valid JSON (outputChars=${outputChars})`);
  }
  if (response.stopReason === 'error' && typeof response.errorMessage === 'string') {
    return new Error(`${label} model request failed: ${response.errorMessage}`);
  }
  return new Error(`${label} did not return valid JSON (stopReason=${String(response.stopReason)}, outputChars=${outputChars})`);
}

function strings(value: unknown, max: number): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .slice(0, max)
      .map((item) => item.trim())
    : [];
}

function validateSuggestion(value: unknown, allowedPaths: Set<string>): WorkDiscoverySuggestion | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  if (typeof item.title !== 'string' || !item.title.trim()) return null;
  if (typeof item.rationale !== 'string' || !item.rationale.trim()) return null;
  if (typeof item.actionPrompt !== 'string' || !item.actionPrompt.trim()) return null;
  const confidence = item.confidence === 'high' || item.confidence === 'medium' || item.confidence === 'low'
    ? item.confidence
    : 'medium';
  const actionType = item.actionType === 'summarize_recent_work'
    || item.actionType === 'inspect_related_tests'
    || item.actionType === 'plan_next_step'
    ? item.actionType
    : 'plan_next_step';
  const risk = item.risk === 'command' || item.risk === 'file_write' ? item.risk : 'analysis';
  const estimatedMinutes = typeof item.estimatedMinutes === 'number' && Number.isFinite(item.estimatedMinutes)
    ? Math.max(1, Math.min(30, Math.round(item.estimatedMinutes)))
    : 3;
  const expectedOutcome = typeof item.expectedOutcome === 'string' && item.expectedOutcome.trim()
    ? item.expectedOutcome.trim().slice(0, 500)
    : item.title.trim().slice(0, 120);
  const evidence = Array.isArray(item.evidence)
    ? item.evidence.flatMap((raw) => {
      if (!raw || typeof raw !== 'object') return [];
      const candidate = raw as Record<string, unknown>;
      if (typeof candidate.observation !== 'string' || !candidate.observation.trim()) return [];
      const path = typeof candidate.path === 'string' && allowedPaths.has(candidate.path)
        ? candidate.path
        : undefined;
      return [{ ...(path ? { path } : {}), observation: candidate.observation.trim().slice(0, 500) }];
    }).slice(0, 4)
    : [];
  if (evidence.length === 0) return null;
  return {
    id: randomUUID(),
    actionType,
    title: item.title.trim().slice(0, 120),
    rationale: item.rationale.trim().slice(0, 600),
    evidence,
    actionPrompt: item.actionPrompt.trim().slice(0, 2_000),
    confidence,
    expectedOutcome,
    estimatedMinutes,
    risk,
    verification: strings(item.verification, 4).map((entry) => entry.slice(0, 300)),
  };
}

function validateProfileCandidate(value: unknown): WorkDiscoveryProfileCandidate | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  const category = item.category === 'role'
    || item.category === 'focus'
    || item.category === 'technology'
    || item.category === 'workflow'
    || item.category === 'preference'
    ? item.category
    : undefined;
  if (!category || typeof item.statement !== 'string') return null;
  const statement = item.statement.trim().slice(0, 500);
  if (statement.length < 4) return null;
  const confidence = item.confidence === 'high' || item.confidence === 'low' ? item.confidence : 'medium';
  return {
    id: randomUUID(),
    category,
    statement,
    confidence,
    evidence: strings(item.evidence, 4).map((entry) => entry.slice(0, 300)),
    status: 'pending',
  };
}

function validateWorkThreadCandidate(value: unknown, allowedRefs: Set<string>): WorkUnderstandingThreadCandidate | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  if (typeof item.title !== 'string' || typeof item.summary !== 'string') return null;
  const title = item.title.trim().slice(0, 200);
  const summary = item.summary.trim().slice(0, 2_000);
  if (!title || !summary) return null;
  const horizon = item.horizon === 'current' || item.horizon === 'ongoing' || item.horizon === 'long_term'
    ? item.horizon
    : 'current';
  const status = item.status === 'active' || item.status === 'paused' || item.status === 'blocked'
    || item.status === 'completed' || item.status === 'uncertain'
    ? item.status
    : 'uncertain';
  const confidence = item.confidence === 'high' || item.confidence === 'low' ? item.confidence : 'medium';
  const topicKeyRaw = typeof item.topicKey === 'string' ? item.topicKey.toLowerCase() : title.toLowerCase();
  const topicKey = topicKeyRaw.replace(/[^a-z0-9\p{L}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 100)
    || `thread-${randomUUID().slice(0, 8)}`;
  const evidenceRefs = strings(item.evidenceRefs, 12).filter((ref) => allowedRefs.has(ref));
  if (!evidenceRefs.length) return null;
  return { topicKey, title, summary, horizon, status, confidence, evidenceRefs };
}

function suggestionScore(suggestion: WorkDiscoverySuggestion): number {
  const confidence = suggestion.confidence === 'high' ? 3 : suggestion.confidence === 'medium' ? 2 : 1;
  const safety = suggestion.risk === 'analysis' ? 3 : suggestion.risk === 'command' ? 2 : 1;
  return confidence * 4 + safety * 2 - Math.min(suggestion.estimatedMinutes, 10) / 10;
}

function snapshotForModel(snapshot: WorkContextSnapshot): WorkContextSnapshot {
  let remaining = MAX_MODEL_CONTEXT_CHARS;
  return {
    ...snapshot,
    structure: {
      ...snapshot.structure,
      sampledPaths: snapshot.structure.sampledPaths.slice(0, 200),
      metadataOnlyFiles: snapshot.structure.metadataOnlyFiles.slice(0, 200),
    },
    documents: snapshot.documents.flatMap((document) => {
      if (remaining <= 0) return [];
      const excerpt = document.excerpt.slice(0, remaining);
      remaining -= excerpt.length;
      return [{ ...document, excerpt, truncated: document.truncated || excerpt.length < document.excerpt.length }];
    }),
  };
}

function lowConfidenceResult(snapshot: WorkContextSnapshot, question?: string): WorkDiscoveryResult {
  return {
    projectSummary: snapshot.root.projectKind === 'coding'
      ? `${snapshot.root.displayName} appears to be a software project.`
      : `${snapshot.root.displayName} is a local work folder.`,
    currentState: snapshot.git?.changedPaths.length
      ? `${snapshot.git.changedPaths.length} changed paths were detected, but there was not enough reliable context to recommend work.`
      : 'There was not enough recent, readable context to determine the current objective.',
    uncertainties: ['The current objective is not explicit in the selected files.'],
    suggestions: [],
    lowConfidence: true,
    contextQuestion: question ?? 'What are you trying to move forward in this folder?',
  };
}

export async function analyzeWorkContext(input: {
  config: Config;
  snapshot: WorkContextSnapshot;
  candidateContext?: WorkDiscoveryCandidate[];
  signal?: AbortSignal;
}): Promise<{ modelRef: string; result: WorkDiscoveryResult }> {
  const modelRef = getAgentDefaultModelRef(input.config);
  if (!modelRef) throw new Error('No default model configured');
  if (input.snapshot.documents.length === 0 && !input.snapshot.git?.changedPaths.length) {
    return { modelRef, result: lowConfidenceResult(input.snapshot) };
  }

  const model = resolveModel(modelRef);
  const compactSnapshot = snapshotForModel(input.snapshot);
  const prompt = [
    'You help a user resume real work in one explicitly selected local folder.',
    'Analyze only the supplied bounded snapshot. Never claim that you ran commands, tests, or inspected anything absent from it.',
    'Return only one JSON object with projectSummary, currentState, uncertainties, suggestions, profileCandidates, workThreads, lowConfidence, and contextQuestion.',
    'profileCandidates contains up to 6 stable, useful facts about the user inferred from the supplied project evidence.',
    'Each profile candidate has category (role, focus, technology, workflow, or preference), statement, confidence, and evidence.',
    'Do not infer sensitive traits, identity, health, finances, political views, or anything not directly supported by the work evidence.',
    'workThreads contains up to 3 evidence-backed work streams with topicKey, title, summary, horizon, status, confidence, and evidenceRefs.',
    'horizon is current, ongoing, or long_term. status is active, paused, blocked, completed, or uncertain.',
    'topicKey is a short stable topic identifier. evidenceRefs must use exact relative paths from the snapshot or git://recent-state.',
    'Distinguish one-off recent edits from work sustained across multiple days. Prefer one current thread and only add ongoing or long_term threads when evidence supports them.',
    'For a normal result, suggestions must contain exactly 3 materially different next steps.',
    'Each suggestion must include actionType, title, rationale, evidence, actionPrompt, confidence, expectedOutcome, estimatedMinutes, risk, and verification.',
    'actionType must be summarize_recent_work, inspect_related_tests, or plan_next_step.',
    'risk must be analysis, command, or file_write. estimatedMinutes is an integer from 1 to 30.',
    'verification is a short array describing how the user can tell the outcome is real.',
    'Each evidence item contains an optional exact relative path from the snapshot and one concrete observation.',
    'actionPrompt asks the assistant to investigate or continue the step; it does not silently authorize file changes.',
    'If the current objective is unclear or fewer than three credible suggestions exist, set lowConfidence=true, return suggestions=[], and ask one concise contextQuestion.',
    'Use Simplified Chinese for every user-facing string when the visible snapshot documents are mainly Chinese; otherwise use English.',
    '',
    input.candidateContext?.length
      ? `Other ranked local work projects (metadata only):\n${JSON.stringify(input.candidateContext.slice(0, 8).map((candidate) => ({
          displayName: candidate.displayName,
          projectKind: candidate.projectKind,
          score: candidate.score,
          lastActiveAt: candidate.lastActiveAt,
          branch: candidate.branch,
          changedFileCount: candidate.changedFileCount,
          evidence: candidate.evidence,
        })))}`
      : '',
    JSON.stringify(compactSnapshot),
  ].join('\n');
  const message: UserMessage = { role: 'user', content: prompt, timestamp: Date.now() };
  const response = await completeWithResolvedCredentials(model, { messages: [message] }, {
    maxTokens: WORK_ANALYSIS_MAX_TOKENS,
    temperature: 0.1,
    signal: input.signal,
  });
  const raw = extractText(response.content);
  const parsed = parseJson(raw);
  if (!parsed) throw invalidJsonError('Analysis', response, raw);

  const lowConfidence = parsed.lowConfidence === true;
  if (lowConfidence) {
    return {
      modelRef,
      result: lowConfidenceResult(
        input.snapshot,
        typeof parsed.contextQuestion === 'string' ? parsed.contextQuestion.trim().slice(0, 500) : undefined,
      ),
    };
  }

  const allowedPaths = new Set([
    ...input.snapshot.documents.map((document) => document.relativePath),
    ...(input.snapshot.git?.changedPaths ?? []),
  ]);
  const allowedThreadRefs = new Set([...allowedPaths, 'git://recent-state']);
  const suggestions = Array.isArray(parsed.suggestions)
    ? parsed.suggestions.map((value) => validateSuggestion(value, allowedPaths)).filter((value): value is WorkDiscoverySuggestion => Boolean(value))
    : [];
  if (suggestions.length !== 3) return { modelRef, result: lowConfidenceResult(input.snapshot) };
  const primarySuggestion = [...suggestions].sort((a, b) => suggestionScore(b) - suggestionScore(a))[0];
  const profileCandidates = input.candidateContext?.length && Array.isArray(parsed.profileCandidates)
    ? parsed.profileCandidates
      .map(validateProfileCandidate)
      .filter((value): value is WorkDiscoveryProfileCandidate => Boolean(value))
      .slice(0, 6)
    : [];
  const workThreadCandidates = Array.isArray(parsed.workThreads)
    ? parsed.workThreads
      .map((value) => validateWorkThreadCandidate(value, allowedThreadRefs))
      .filter((value): value is WorkUnderstandingThreadCandidate => Boolean(value))
      .slice(0, 3)
    : [];
  const projectSummary = typeof parsed.projectSummary === 'string' ? parsed.projectSummary.trim() : '';
  const currentState = typeof parsed.currentState === 'string' ? parsed.currentState.trim() : '';
  if (!projectSummary || !currentState) throw new Error('Analysis result is missing its summary');
  return {
    modelRef,
    result: {
      projectSummary: projectSummary.slice(0, 1_200),
      currentState: currentState.slice(0, 1_200),
      uncertainties: strings(parsed.uncertainties, 6).map((value) => value.slice(0, 500)),
      suggestions,
      ...(profileCandidates.length > 0 ? { profileCandidates } : {}),
      ...(workThreadCandidates.length > 0 ? { workThreadCandidates } : {}),
      ...(primarySuggestion ? { primarySuggestionId: primarySuggestion.id } : {}),
    },
  };
}

export async function analyzePersonalContext(input: {
  config: Config;
  items: WorkDiscoveryPersonalContextItem[];
  workContext?: Pick<WorkDiscoveryResult, 'projectSummary' | 'currentState' | 'uncertainties' | 'workThreads'>;
  signal?: AbortSignal;
}): Promise<{
  modelRef: string;
  profileCandidates: WorkDiscoveryProfileCandidate[];
  workThreadCandidates: WorkUnderstandingThreadCandidate[];
}> {
  const modelRef = getAgentDefaultModelRef(input.config);
  if (!modelRef) throw new Error('No default model configured');
  let remaining = MAX_PERSONAL_CONTEXT_CHARS;
  const items = input.items.slice(0, 150).flatMap((item, index) => {
    if (remaining <= 0) return [];
    const content = item.content.slice(0, remaining);
    remaining -= content.length;
    return [{
      ref: `${item.source}:${index + 1}`,
      source: item.source,
      title: item.title,
      group: item.group,
      createdAt: item.createdAt,
      modifiedAt: item.modifiedAt,
      startsAt: item.startsAt,
      endsAt: item.endsAt,
      content,
    }];
  });
  if (!items.some((item) => item.title.trim() || item.content.trim())) {
    return { modelRef, profileCandidates: [], workThreadCandidates: [] };
  }
  const prompt = [
    'Analyze the bounded personal work context that the user explicitly chose to connect from Apple Notes, Calendar, and Reminders.',
    'Return only one JSON object with profileCandidates and workThreads.',
    'profileCandidates contains at most 6 stable, useful work-related facts.',
    'Each item has category (role, focus, technology, workflow, or preference), statement, confidence, and evidence.',
    'workThreads contains at most 3 evidence-backed current, ongoing, or long-term work streams.',
    'Each work thread has topicKey, title, summary, status, horizon, confidence, and evidenceRefs.',
    'evidenceRefs must contain only the supplied source:index refs. Do not create a thread without direct support.',
    'Prefer recurring work themes and durable preferences. Do not turn one-off errands or stale notes into user facts.',
    'Do not infer sensitive identity, health, finances, political views, relationships, passwords, credentials, or private contact details.',
    'Evidence must be a short paraphrase and must not quote private note content verbatim.',
    'Calendar and reminder titles may establish commitments and timing, but must not be treated as stable preferences without repeated evidence.',
    'When a work-directory summary is supplied, reconcile it with the personal sources: identify corroboration, conflicts, and whether an apparent focus is current or merely stale.',
    'Do not repeat the directory summary as a personal fact unless at least one supplied personal source supports it.',
    'Use Simplified Chinese when the supplied items are mainly Chinese; otherwise use English.',
    input.workContext ? `Work-directory understanding from the same one-shot investigation:\n${JSON.stringify(input.workContext)}` : '',
    JSON.stringify(items),
  ].join('\n');
  const model = resolveModel(modelRef);
  const message: UserMessage = { role: 'user', content: prompt, timestamp: Date.now() };
  const response = await completeWithResolvedCredentials(model, { messages: [message] }, {
    maxTokens: 1_500,
    temperature: 0.1,
    signal: input.signal,
  });
  const raw = extractText(response.content);
  const parsed = parseJson(raw);
  if (!parsed) throw invalidJsonError('Personal context analysis', response, raw);
  const profileCandidates = Array.isArray(parsed.profileCandidates)
    ? parsed.profileCandidates
      .map(validateProfileCandidate)
      .filter((value): value is WorkDiscoveryProfileCandidate => Boolean(value))
      .slice(0, 6)
    : [];
  const allowedRefs = new Set(items.map((item) => item.ref));
  const workThreadCandidates = Array.isArray(parsed.workThreads)
    ? parsed.workThreads
      .map((value) => validateWorkThreadCandidate(value, allowedRefs))
      .filter((value): value is WorkUnderstandingThreadCandidate => Boolean(value))
      .slice(0, 3)
    : [];
  return { modelRef, profileCandidates, workThreadCandidates };
}

export function workDiscoveryResultMarkdown(result: WorkDiscoveryResult): string {
  const lines = [`## What I found`, '', result.projectSummary, '', result.currentState];
  if (result.lowConfidence) {
    if (result.contextQuestion) lines.push('', `**${result.contextQuestion}**`);
    return lines.join('\n');
  }
  lines.push('', '## Suggested next steps');
  for (const [index, suggestion] of result.suggestions.entries()) {
    lines.push('', `### ${index + 1}. ${suggestion.title}`, '', suggestion.rationale, '', `Expected outcome: ${suggestion.expectedOutcome}`, '');
    for (const evidence of suggestion.evidence) {
      lines.push(`- ${evidence.path ? `\`${evidence.path}\`: ` : ''}${evidence.observation}`);
    }
  }
  return lines.join('\n');
}
