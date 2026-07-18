import { randomUUID } from 'node:crypto';

import type { CommandDefinition, CommandContext } from '../types.js';
import { commandRegistry } from '../registry.js';
import { effectiveWorkspacePathForSession } from '../../session/session-workspace.js';
import { resolveEffectiveAgentProfileForSession } from '../../config/agent-profile.js';
import { getProjectForSession } from '../../projects/workspace.js';
import {
  buildReviewDiffBundle,
  parseReviewTargetArgs,
  resolveGitRoot,
} from '../../review/review-git.js';
import {
  formatReviewMarkdown,
  type ReviewFinding,
  type ReviewOutput,
  type ReviewPriority,
} from '../../review/review-types.js';

const MAX_DIFF_CHARS = 60_000;
const REVIEW_JUDGE_MAX_TOKENS = 16_384;

async function emitToolStart(
  ctx: CommandContext,
  toolCallId: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<void> {
  await ctx.emitEvent?.({
    type: 'tool_execution_start',
    toolCallId,
    toolName,
    args,
  });
}

async function emitToolEnd(
  ctx: CommandContext,
  toolCallId: string,
  toolName: string,
  resultText: string,
  details?: Record<string, unknown>,
  isError = false,
): Promise<void> {
  await ctx.emitEvent?.({
    type: 'tool_execution_end',
    toolCallId,
    toolName,
    isError,
    result: {
      content: [{ type: 'text', text: resultText }],
      ...(details ? { details } : {}),
    },
  });
}

function truncateForPrompt(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_DIFF_CHARS) return { text, truncated: false };
  return {
    text: text.slice(0, MAX_DIFF_CHARS) + '\n\n[diff truncated]',
    truncated: true,
  };
}

function extractJsonObject(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const text = (fenced?.[1] ?? raw).trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('review response did not contain JSON');
  return JSON.parse(text.slice(start, end + 1));
}

function priorityFrom(raw: unknown): ReviewPriority {
  const n = typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? ''), 10);
  if (n === 0 || n === 1 || n === 2 || n === 3) return n;
  return 2;
}

function numberFrom(raw: unknown): number | undefined {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined;
}

function stringFrom(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : '';
}

function parseReviewJson(raw: string, target: string): ReviewOutput {
  const parsed = extractJsonObject(raw);
  const rec = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};
  const rawFindings = Array.isArray(rec.findings) ? rec.findings : [];
  const findings: ReviewFinding[] = rawFindings
    .map((item) => {
      const f = item && typeof item === 'object' && !Array.isArray(item)
        ? item as Record<string, unknown>
        : {};
      const loc = f.code_location && typeof f.code_location === 'object'
        ? f.code_location as Record<string, unknown>
        : {};
      const range = loc.line_range && typeof loc.line_range === 'object'
        ? loc.line_range as Record<string, unknown>
        : {};
      const title = stringFrom(f.title);
      const body = stringFrom(f.body);
      if (!title && !body) return undefined;
      const finding: ReviewFinding = {
        title: title || body.slice(0, 80),
        body,
        priority: priorityFrom(f.priority),
      };
      const confidenceScore = numberFrom(f.confidence_score ?? f.confidenceScore);
      const filePath = stringFrom(loc.file_path ?? f.filePath);
      const lineStart = numberFrom(range.start ?? f.lineStart);
      const lineEnd = numberFrom(range.end ?? f.lineEnd);
      if (confidenceScore !== undefined) finding.confidenceScore = confidenceScore;
      if (filePath) finding.filePath = filePath;
      if (lineStart !== undefined) finding.lineStart = lineStart;
      if (lineEnd !== undefined) finding.lineEnd = lineEnd;
      return finding;
    })
    .filter((item): item is ReviewFinding => Boolean(item));

  const correctness = stringFrom(rec.overall_correctness ?? rec.overallCorrectness);
  const overallCorrectness =
    correctness === 'patch is correct' || correctness === 'patch is incorrect'
      ? correctness
      : 'unknown';
  return {
    type: 'review',
    target,
    summary: stringFrom(rec.summary) || `${findings.length} finding${findings.length === 1 ? '' : 's'}`,
    findings,
    overallCorrectness,
    overallExplanation: stringFrom(rec.overall_explanation ?? rec.overallExplanation),
    overallConfidenceScore: numberFrom(rec.overall_confidence_score ?? rec.overallConfidenceScore),
    generatedAt: Date.now(),
    source: 'model',
  };
}

function previewText(text: string, max = 500): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

async function reviewModelRef(ctx: CommandContext): Promise<string | undefined> {
  const sessionOverride = await ctx.getSessionConfigStore?.()
    ?.get(ctx.sessionKey)
    .then((config) => config?.modelOverride?.trim())
    .catch(() => undefined);
  if (sessionOverride) return sessionOverride;

  try {
    const profile = resolveEffectiveAgentProfileForSession(ctx.config, ctx.sessionKey);
    return profile.manifest.models.roles.review?.model?.trim() || profile.primaryModelRef;
  } catch {
    return undefined;
  }
}

function buildReviewPrompt(params: {
  target: string;
  status: string;
  stat: string;
  diff: string;
  truncated: boolean;
  instructions: string;
}): string {
  return [
    'You are a senior code reviewer. Review the provided git diff for correctness bugs only.',
    'Prioritize concrete regressions, broken behavior, missing required tests for changed behavior, data loss, security issues, and runtime/type errors.',
    'Do not mention style, broad refactors, praise, or speculative improvements.',
    'Return strict JSON only with this shape:',
    '{"findings":[{"title":"...","body":"...","priority":1,"confidence_score":0.9,"code_location":{"file_path":"path","line_range":{"start":12,"end":12}}}],"overall_correctness":"patch is correct","overall_explanation":"...","overall_confidence_score":0.8,"summary":"..."}',
    'Use priority 0 for release-blocking, 1 for high, 2 for medium, 3 for low.',
    params.instructions ? `Extra reviewer instructions: ${params.instructions}` : '',
    `Target: ${params.target}`,
    params.truncated ? 'The diff was truncated; only report findings supported by visible lines.' : '',
    'Git status:',
    params.status || '(clean)',
    'Diff stat:',
    params.stat || '(none)',
    'Diff:',
    params.diff || '(none)',
  ].filter(Boolean).join('\n\n');
}

async function resolveWorkspace(ctx: CommandContext): Promise<string> {
  const sessionConfigStore = ctx.getSessionConfigStore?.();
  const sessionConfig = sessionConfigStore
    ? await sessionConfigStore.get(ctx.sessionKey).catch(() => null)
    : null;
  return effectiveWorkspacePathForSession(
    ctx.config,
    ctx.sessionKey,
    sessionConfig,
    getProjectForSession(ctx.sessionKey),
  );
}

async function buildReview(ctx: CommandContext, args: string): Promise<ReviewOutput> {
  const workspace = await resolveWorkspace(ctx);
  const cwd = await resolveGitRoot(workspace);
  const reviewTarget = parseReviewTargetArgs(args);
  const prepareToolCallId = `review_prepare_${randomUUID()}`;
  await emitToolStart(ctx, prepareToolCallId, 'review.prepare_diff', {
    target: args.trim() || 'uncommitted',
    cwd,
  });
  let bundle: Awaited<ReturnType<typeof buildReviewDiffBundle>>;
  try {
    bundle = await buildReviewDiffBundle(cwd, reviewTarget);
    await emitToolEnd(
      ctx,
      prepareToolCallId,
      'review.prepare_diff',
      [
        `Target: ${bundle.targetLabel}`,
        bundle.stat.trim() ? `Changed files:\n${bundle.stat.trim()}` : 'No diff stat.',
      ].join('\n\n'),
      {
        target: bundle.targetLabel,
        status: bundle.status,
        stat: bundle.stat,
      },
    );
  } catch (err) {
    const em = err instanceof Error ? err.message : String(err);
    await emitToolEnd(ctx, prepareToolCallId, 'review.prepare_diff', em, { cwd }, true);
    throw err;
  }
  const { text: diff, truncated } = truncateForPrompt(bundle.diff);
  const target = bundle.targetLabel;
  const instructions = reviewTarget.instructions ?? '';

  if (!bundle.status.trim() && !bundle.diff.trim()) {
    return {
      type: 'review',
      target,
      summary: 'Working tree is clean.',
      findings: [],
      overallCorrectness: 'patch is correct',
      overallExplanation: 'No uncommitted changes were found to review.',
      generatedAt: Date.now(),
      source: 'local',
    };
  }

  const prompt = buildReviewPrompt({
    target,
    status: bundle.status,
    stat: bundle.stat,
    diff,
    truncated,
    instructions,
  });
  const reviewerModelRef = await reviewModelRef(ctx);
  const judgeToolCallId = `review_judge_${randomUUID()}`;
  await emitToolStart(ctx, judgeToolCallId, 'review.model_judge', {
    target,
    diffChars: diff.length,
    truncated,
    ...(reviewerModelRef ? { modelRef: reviewerModelRef } : {}),
  });
  const answer = ctx.btwQuery
    ? await ctx.btwQuery(prompt, {
        maxTokens: REVIEW_JUDGE_MAX_TOKENS,
        includeSessionContext: false,
        ...(reviewerModelRef ? { modelRef: reviewerModelRef } : {}),
      })
    : { text: '', error: 'Review model query is not available in this command context.' };
  let judgeFailure = answer.error
    ? { reason: `Reviewer model error: ${answer.error}` }
    : answer.text
      ? undefined
      : { reason: 'Reviewer model returned no text.' };
  if (answer?.text && !answer.error) {
    try {
      const parsed = parseReviewJson(answer.text, target);
      await emitToolEnd(
        ctx,
        judgeToolCallId,
        'review.model_judge',
        parsed.summary || `${parsed.findings.length} findings`,
        {
          target,
          findings: parsed.findings.length,
          overallCorrectness: parsed.overallCorrectness,
        },
      );
      return parsed;
    } catch (err) {
      const em = err instanceof Error ? err.message : String(err);
      judgeFailure = {
        reason: `Reviewer model output could not be parsed: ${em}`,
      };
    }
  }

  const reason = judgeFailure?.reason ?? 'Reviewer model output could not be parsed.';
  const fallback: ReviewOutput = {
    type: 'review',
    target,
    summary: 'Review model did not complete; returned a local diff summary.',
    findings: [],
    overallCorrectness: 'unknown',
    overallExplanation: [
      reason,
      bundle.stat.trim() ? `Changed files:\n${bundle.stat.trim()}` : 'No textual diff stat was available.',
    ].join('\n\n'),
    generatedAt: Date.now(),
    source: 'local',
  };
  await emitToolEnd(
    ctx,
    judgeToolCallId,
    'review.model_judge',
    fallback.summary,
    {
      target,
      findings: 0,
      overallCorrectness: fallback.overallCorrectness,
      fallback: true,
      reason,
      ...(answer.text ? { responsePreview: previewText(answer.text) } : {}),
    },
    true,
  );
  return fallback;
}

const reviewCommand: CommandDefinition = {
  id: 'coding.review',
  name: 'review',
  description: 'Review current workspace changes for correctness issues',
  category: 'tool',
  scope: ['global', 'private', 'group'],
  acceptsArgs: true,
  examples: ['/review', '/review focus on auth and persistence'],
  handler: async (ctx: CommandContext, args: string) => {
    await ctx.setTyping(true);
    const review = await buildReview(ctx, args);
    return {
      content: formatReviewMarkdown(review),
      success: true,
      metadata: { review },
    };
  },
};

export function registerReviewCommand(): void {
  commandRegistry.register(reviewCommand);
}
