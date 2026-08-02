import { createHash } from 'node:crypto';

import type { UserMessage } from '@earendil-works/pi-ai/compat';

import type { Config } from '../config/schema.js';
import { getAgentDefaultModelRef } from '../config/schema.js';
import { completeWithResolvedCredentials } from '../providers/model-call.js';
import { resolveModel } from '../providers/index.js';
import { createLogger } from '../utils/logger.js';

import {
  appendWorkUnderstandingEvidence,
  createWorkUnderstandingInvestigation,
  getWorkUnderstandingInvestigationForRun,
  resetWorkUnderstandingInvestigation,
  updateWorkUnderstandingEvidenceObservation,
  updateWorkUnderstandingInvestigation,
} from './investigation-repository.js';
import { readWorkDiscoveryTextExcerpt, searchWorkDiscoveryText } from './probe.js';
import type {
  WorkContextDocument,
  WorkContextSnapshot,
  WorkUnderstandingEvidenceItem,
  WorkUnderstandingInvestigation,
  WorkUnderstandingInvestigationBudget,
} from './types.js';

const log = createLogger('WorkInvestigator');

export const DEFAULT_WORK_INVESTIGATION_BUDGET: WorkUnderstandingInvestigationBudget = {
  maxToolCalls: 6,
  maxContentChars: 60_000,
  maxDurationMs: 25_000,
};

type InvestigationAction =
  | { tool: 'read_text_excerpt'; relativePath: string; reason: string }
  | { tool: 'search_authorized_text'; query: string; reason: string }
  | { tool: 'finish'; reason: string };

export interface InvestigationDecision {
  hypotheses: string[];
  questions: string[];
  evidenceSummaries: Array<{ evidenceId: string; observation: string }>;
  action: InvestigationAction;
}

interface RuntimeEvidence {
  record: WorkUnderstandingEvidenceItem;
  content: string;
  modifiedAt?: number;
}

export interface WorkInvestigationResult {
  investigation: WorkUnderstandingInvestigation;
  evidence: WorkUnderstandingEvidenceItem[];
  documents: WorkContextDocument[];
  degraded: boolean;
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((part) => {
    if (!part || typeof part !== 'object') return '';
    const item = part as { type?: unknown; text?: unknown };
    return item.type === 'text' && typeof item.text === 'string' ? item.text : '';
  }).join('');
}

function parseObject(raw: string): Record<string, unknown> | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw)?.[1];
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  try {
    const parsed = JSON.parse(fenced ?? (start >= 0 && end > start ? raw.slice(start, end + 1) : raw)) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function stringList(value: unknown, max: number, maxChars: number): string[] {
  return Array.isArray(value)
    ? value.flatMap((item) => typeof item === 'string' && item.trim() ? [item.trim().slice(0, maxChars)] : []).slice(0, max)
    : [];
}

function decisionFromValue(value: unknown, allowedPaths: Set<string>): InvestigationDecision | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  const rawAction = item.action;
  if (!rawAction || typeof rawAction !== 'object') return null;
  const actionValue = rawAction as Record<string, unknown>;
  const reason = typeof actionValue.reason === 'string' ? actionValue.reason.trim().slice(0, 300) : '';
  let action: InvestigationAction | null = null;
  if (actionValue.tool === 'finish') {
    action = { tool: 'finish', reason: reason || 'Enough evidence was collected.' };
  } else if (actionValue.tool === 'read_text_excerpt') {
    const relativePath = typeof actionValue.relativePath === 'string' ? actionValue.relativePath.trim() : '';
    if (allowedPaths.has(relativePath)) action = { tool: 'read_text_excerpt', relativePath, reason };
  } else if (actionValue.tool === 'search_authorized_text') {
    const query = typeof actionValue.query === 'string' ? actionValue.query.trim().slice(0, 120) : '';
    if (query.length >= 2) action = { tool: 'search_authorized_text', query, reason };
  }
  if (!action) return null;
  const evidenceSummaries = Array.isArray(item.evidenceSummaries)
    ? item.evidenceSummaries.flatMap((raw) => {
      if (!raw || typeof raw !== 'object') return [];
      const summary = raw as Record<string, unknown>;
      return typeof summary.evidenceId === 'string' && typeof summary.observation === 'string'
        ? [{
            evidenceId: summary.evidenceId,
            observation: summary.observation.trim().slice(0, 1_000),
          }]
        : [];
    }).slice(0, 20)
    : [];
  return {
    hypotheses: stringList(item.hypotheses, 6, 400),
    questions: stringList(item.questions, 6, 400),
    evidenceSummaries,
    action,
  };
}

function metadataForModel(snapshot: WorkContextSnapshot) {
  return {
    root: snapshot.root,
    structure: {
      sampledPaths: snapshot.structure.sampledPaths.slice(0, 200),
      omittedPathCount: snapshot.structure.omittedPathCount,
    },
    git: snapshot.git,
    candidateDocuments: snapshot.documents.slice(0, 30).map((document) => ({
      relativePath: document.relativePath,
      modifiedAt: document.modifiedAt,
      selectionReason: document.selectionReason,
      truncated: document.truncated,
    })),
  };
}

async function chooseAction(input: {
  config: Config;
  snapshot: WorkContextSnapshot;
  runtimeEvidence: RuntimeEvidence[];
  toolCallsRemaining: number;
  contentCharsRemaining: number;
  signal?: AbortSignal;
}): Promise<InvestigationDecision | null> {
  const modelRef = getAgentDefaultModelRef(input.config);
  if (!modelRef) throw new Error('No default model configured');
  const evidence = input.runtimeEvidence.slice(-16).map((item) => ({
    evidenceId: item.record.id,
    sourceType: item.record.sourceType,
    sourceRef: item.record.sourceRef,
    content: item.content.slice(0, 8_000),
  }));
  const prompt = [
    'You are a bounded, read-only work investigation agent.',
    'Your goal is to determine what the user is currently focused on and what work is being continuously advanced.',
    'Form hypotheses, identify missing evidence, and choose exactly one next action.',
    'Available actions are read_text_excerpt(relativePath), search_authorized_text(query), or finish.',
    'Only choose relativePath values present in sampledPaths. Do not request secrets, credentials, personal traits, or unrelated private information.',
    'Prefer evidence that distinguishes a current multi-day work thread from a one-off recent edit.',
    'Use search only for a concise work topic visible in existing metadata or evidence.',
    'Choose finish when evidence is sufficient or the remaining budget cannot materially improve the conclusion.',
    'Return one JSON object with hypotheses, questions, evidenceSummaries, and action.',
    'evidenceSummaries may paraphrase prior evidence by evidenceId; do not quote private content verbatim.',
    `Remaining budget: ${input.toolCallsRemaining} tool calls, ${input.contentCharsRemaining} content characters.`,
    JSON.stringify({ metadata: metadataForModel(input.snapshot), evidence }),
  ].join('\n');
  const response = await completeWithResolvedCredentials(
    resolveModel(modelRef),
    { messages: [{ role: 'user', content: prompt, timestamp: Date.now() } satisfies UserMessage] },
    { maxTokens: 1_200, temperature: 0.1, signal: input.signal },
  );
  const parsed = parseObject(extractText(response.content));
  return decisionFromValue(parsed, new Set(input.snapshot.structure.sampledPaths));
}

function contentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export async function investigateWorkContext(input: {
  config: Config;
  snapshot: WorkContextSnapshot;
  rootPath: string;
  discoveryRunId: string;
  projectId: string;
  sourceGrantId?: string;
  budget?: Partial<WorkUnderstandingInvestigationBudget>;
  decisionProvider?: typeof chooseAction;
  signal?: AbortSignal;
}): Promise<WorkInvestigationResult> {
  const budget: WorkUnderstandingInvestigationBudget = {
    maxToolCalls: Math.max(1, Math.min(12, input.budget?.maxToolCalls ?? DEFAULT_WORK_INVESTIGATION_BUDGET.maxToolCalls)),
    maxContentChars: Math.max(4_000, Math.min(120_000, input.budget?.maxContentChars ?? DEFAULT_WORK_INVESTIGATION_BUDGET.maxContentChars)),
    maxDurationMs: Math.max(100, Math.min(60_000, input.budget?.maxDurationMs ?? DEFAULT_WORK_INVESTIGATION_BUDGET.maxDurationMs)),
  };
  const existing = getWorkUnderstandingInvestigationForRun(input.discoveryRunId);
  let investigation = existing
    ? resetWorkUnderstandingInvestigation(existing.id, budget)!
    : createWorkUnderstandingInvestigation({ discoveryRunId: input.discoveryRunId, budget });
  investigation = updateWorkUnderstandingInvestigation(investigation.id, {
    status: 'investigating',
    plan: { hypotheses: [], questions: [] },
    toolCallCount: 0,
    contentCharsRead: 0,
    errorMessage: undefined,
    completedAt: undefined,
  })!;
  const startedAt = Date.now();
  const deadlineSignal = AbortSignal.timeout(budget.maxDurationMs);
  const investigationSignal = input.signal
    ? AbortSignal.any([input.signal, deadlineSignal])
    : deadlineSignal;
  const runtimeEvidence: RuntimeEvidence[] = [];
  const documents = new Map<string, WorkContextDocument>();
  let degraded = false;

  if (input.snapshot.git) {
    const content = JSON.stringify(input.snapshot.git);
    const record = appendWorkUnderstandingEvidence({
      investigationId: investigation.id,
      ...(input.sourceGrantId ? { sourceGrantId: input.sourceGrantId } : {}),
      projectId: input.projectId,
      sourceType: 'git',
      sourceRef: 'git://recent-state',
      observation: `Collected recent Git state with ${input.snapshot.git.changedPaths.length} changed paths.`,
      contentHash: contentHash(content),
      collectedAt: Date.now(),
      sensitivity: 'normal',
    });
    runtimeEvidence.push({ record, content });
  }

  try {
    while (
      investigation.toolCallCount < budget.maxToolCalls
      && investigation.contentCharsRead < budget.maxContentChars
      && Date.now() - startedAt < budget.maxDurationMs
    ) {
      if (input.signal?.aborted) throw new DOMException('Work investigation canceled', 'AbortError');
      let decision: InvestigationDecision | null = null;
      try {
        decision = await (input.decisionProvider ?? chooseAction)({
          config: input.config,
          snapshot: input.snapshot,
          runtimeEvidence,
          toolCallsRemaining: budget.maxToolCalls - investigation.toolCallCount,
          contentCharsRemaining: budget.maxContentChars - investigation.contentCharsRead,
          signal: investigationSignal,
        });
      } catch (error) {
        if (input.signal?.aborted) throw error;
        degraded = true;
        log.debug({ err: error, investigationId: investigation.id, phase: 'planning' }, 'Work investigation planning degraded');
      }
      if (!decision) break;
      for (const summary of decision.evidenceSummaries) {
        if (runtimeEvidence.some((item) => item.record.id === summary.evidenceId) && summary.observation) {
          updateWorkUnderstandingEvidenceObservation(summary.evidenceId, summary.observation);
          const runtime = runtimeEvidence.find((item) => item.record.id === summary.evidenceId);
          if (runtime) runtime.record = { ...runtime.record, observation: summary.observation };
        }
      }
      investigation = updateWorkUnderstandingInvestigation(investigation.id, {
        plan: { hypotheses: decision.hypotheses, questions: decision.questions },
      })!;
      if (decision.action.tool === 'finish') break;
      investigation = updateWorkUnderstandingInvestigation(investigation.id, {
        toolCallCount: investigation.toolCallCount + 1,
      })!;

      const charsRemaining = budget.maxContentChars - investigation.contentCharsRead;
      try {
        if (decision.action.tool === 'read_text_excerpt') {
          const result = await readWorkDiscoveryTextExcerpt({
            rootPath: input.rootPath,
            relativePath: decision.action.relativePath,
            maxChars: Math.min(12_000, charsRemaining),
            signal: investigationSignal,
          });
          if (result.excerpt) {
            const record = appendWorkUnderstandingEvidence({
              investigationId: investigation.id,
              ...(input.sourceGrantId ? { sourceGrantId: input.sourceGrantId } : {}),
              projectId: input.projectId,
              sourceType: 'file',
              sourceRef: result.relativePath,
              observation: `Read a bounded excerpt from ${result.relativePath}.`,
              contentHash: contentHash(result.excerpt),
              observedAt: result.modifiedAt,
              sensitivity: 'normal',
            });
            runtimeEvidence.push({ record, content: result.excerpt, modifiedAt: result.modifiedAt });
            documents.set(result.relativePath, {
              relativePath: result.relativePath,
              modifiedAt: result.modifiedAt,
              excerpt: result.excerpt,
              truncated: result.truncated,
              selectionReason: `agent_investigation: ${decision.action.reason}`.slice(0, 300),
            });
            investigation = updateWorkUnderstandingInvestigation(investigation.id, {
              contentCharsRead: investigation.contentCharsRead + result.excerpt.length,
            })!;
          }
        } else {
          const results = await searchWorkDiscoveryText({
            rootPath: input.rootPath,
            relativePaths: input.snapshot.structure.sampledPaths,
            query: decision.action.query,
            signal: investigationSignal,
          });
          let charsRead = 0;
          for (const result of results) {
            const excerpt = result.excerpt.slice(0, Math.max(0, charsRemaining - charsRead));
            if (!excerpt) break;
            charsRead += excerpt.length;
            const record = appendWorkUnderstandingEvidence({
              investigationId: investigation.id,
              ...(input.sourceGrantId ? { sourceGrantId: input.sourceGrantId } : {}),
              projectId: input.projectId,
              sourceType: 'file',
              sourceRef: result.relativePath,
              observation: `Found a bounded match for "${decision.action.query}" in ${result.relativePath}.`,
              contentHash: contentHash(excerpt),
              observedAt: result.modifiedAt,
              sensitivity: 'normal',
            });
            runtimeEvidence.push({ record, content: excerpt, modifiedAt: result.modifiedAt });
            documents.set(result.relativePath, {
              relativePath: result.relativePath,
              modifiedAt: result.modifiedAt,
              excerpt,
              truncated: true,
              selectionReason: `agent_search: ${decision.action.reason}`.slice(0, 300),
            });
          }
          investigation = updateWorkUnderstandingInvestigation(investigation.id, {
            contentCharsRead: investigation.contentCharsRead + charsRead,
          })!;
        }
      } catch (error) {
        if (input.signal?.aborted) throw error;
        degraded = true;
        log.debug({
          err: error,
          investigationId: investigation.id,
          tool: decision.action.tool,
          phase: 'tool_execution',
        }, 'Work investigation tool call skipped');
      }
    }

    if (documents.size === 0) {
      degraded = true;
      for (const document of input.snapshot.documents.slice(0, 6)) {
        if (investigation.contentCharsRead >= budget.maxContentChars) break;
        const excerpt = document.excerpt.slice(0, budget.maxContentChars - investigation.contentCharsRead);
        if (!excerpt) continue;
        const record = appendWorkUnderstandingEvidence({
          investigationId: investigation.id,
          ...(input.sourceGrantId ? { sourceGrantId: input.sourceGrantId } : {}),
          projectId: input.projectId,
          sourceType: 'file',
          sourceRef: document.relativePath,
          observation: `Used the bounded discovery excerpt from ${document.relativePath} as fallback evidence.`,
          contentHash: contentHash(excerpt),
          observedAt: document.modifiedAt,
          sensitivity: 'normal',
        });
        runtimeEvidence.push({ record, content: excerpt, modifiedAt: document.modifiedAt });
        documents.set(document.relativePath, { ...document, excerpt, selectionReason: 'investigation_fallback' });
        investigation = updateWorkUnderstandingInvestigation(investigation.id, {
          contentCharsRead: investigation.contentCharsRead + excerpt.length,
        })!;
      }
    }
    investigation = updateWorkUnderstandingInvestigation(investigation.id, {
      status: 'completed',
      completedAt: Date.now(),
    })!;
    return {
      investigation,
      evidence: runtimeEvidence.map((item) => item.record),
      documents: [...documents.values()],
      degraded,
    };
  } catch (error) {
    const canceled = input.signal?.aborted || (error instanceof DOMException && error.name === 'AbortError');
    updateWorkUnderstandingInvestigation(investigation.id, {
      status: canceled ? 'canceled' : 'failed',
      errorMessage: error instanceof Error ? error.message : String(error),
      completedAt: Date.now(),
    });
    throw error;
  }
}
