import type { CommandDefinition, CommandContext } from '../types.js';
import { commandRegistry } from '../registry.js';
import { effectiveWorkspacePathForSession } from '../../session/session-workspace.js';
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
  const bundle = await buildReviewDiffBundle(cwd, reviewTarget);
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
  const answer = await ctx.btwQuery?.(prompt);
  if (answer?.text && !answer.error) {
    try {
      return parseReviewJson(answer.text, target);
    } catch {
      // Fall through to a deterministic local summary when model output is not parseable.
    }
  }

  return {
    type: 'review',
    target,
    summary: 'Review model was unavailable; returned a local diff summary.',
    findings: [],
    overallCorrectness: 'unknown',
    overallExplanation: [
      answer?.error ? `Reviewer model error: ${answer.error}` : 'Reviewer model output could not be parsed.',
      bundle.stat.trim() ? `Changed files:\n${bundle.stat.trim()}` : 'No textual diff stat was available.',
    ].join('\n\n'),
    generatedAt: Date.now(),
    source: 'local',
  };
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
