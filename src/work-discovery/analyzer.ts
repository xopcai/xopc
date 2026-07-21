import { randomUUID } from 'node:crypto';

import type { UserMessage } from '@earendil-works/pi-ai/compat';

import type { Config } from '../config/schema.js';
import { getAgentDefaultModelRef } from '../config/schema.js';
import { completeWithResolvedCredentials } from '../providers/model-call.js';
import { resolveModel } from '../providers/index.js';

import type {
  WorkContextSnapshot,
  WorkDiscoveryResult,
  WorkDiscoverySuggestion,
} from './types.js';

const MAX_MODEL_CONTEXT_CHARS = 120_000;

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
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw)?.[1];
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  const candidate = fenced ?? (start >= 0 && end > start ? raw.slice(start, end + 1) : raw);
  try {
    const value = JSON.parse(candidate) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
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
    'Return only one JSON object with projectSummary, currentState, uncertainties, suggestions, lowConfidence, and contextQuestion.',
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
    JSON.stringify(compactSnapshot),
  ].join('\n');
  const message: UserMessage = { role: 'user', content: prompt, timestamp: Date.now() };
  const response = await completeWithResolvedCredentials(model, { messages: [message] }, {
    maxTokens: 2_500,
    temperature: 0.1,
    signal: input.signal,
  });
  const parsed = parseJson(extractText(response.content));
  if (!parsed) throw new Error('Analysis did not return valid JSON');

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
    ...input.snapshot.structure.sampledPaths,
    ...input.snapshot.documents.map((document) => document.relativePath),
    ...(input.snapshot.git?.changedPaths ?? []),
  ]);
  const suggestions = Array.isArray(parsed.suggestions)
    ? parsed.suggestions.map((value) => validateSuggestion(value, allowedPaths)).filter((value): value is WorkDiscoverySuggestion => Boolean(value))
    : [];
  if (suggestions.length !== 3) return { modelRef, result: lowConfidenceResult(input.snapshot) };
  const primarySuggestion = [...suggestions].sort((a, b) => suggestionScore(b) - suggestionScore(a))[0];
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
      ...(primarySuggestion ? { primarySuggestionId: primarySuggestion.id } : {}),
    },
  };
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
