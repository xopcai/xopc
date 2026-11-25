import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { z } from 'zod';

import {
  resolveGlobalSkillsRoot,
  resolveWorkspaceSkillsRoot,
} from '../agent/skills/skill-manage-ops.js';
import { AgentCatalogRepository } from '../agent-catalog/repository.js';
import type { Config } from '../config/schema.js';
import { resolveSkillsDir } from '../config/paths.js';
import { writeTextAtomicSync } from '../infra/write-file-atomic.js';
import { getPersonalAgent, resolvePersonalOwnerId } from '../personal-agent/repository.js';
import {
  createProactiveSubscription,
  patchProactiveSubscription,
  saveProactiveItem,
  listProactiveSubscriptions,
} from '../proactive-hub/repository.js';
import type { ProactiveItem } from '../proactive-hub/types.js';
import { resolveModel } from '../providers/index.js';
import { completeWithResolvedCredentials } from '../providers/model-call.js';
import { extractAssistantText, getAssistantMessageErrorReason, stripCodeFences } from '../providers/model-response.js';
import { DurableState } from '../storage/sqlite/durable-state.js';
import { afterSqliteCommit, getSqliteDatabase, runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';
import { createLogger } from '../utils/logger.js';
import {
  currentRsiSkillVersion,
  ensureRsiTelemetryVersion,
  getRsiCandidate,
  nextAdoptedCapabilityVersion,
  recordRsiVerificationResult,
  saveRsiCandidate,
  transitionRsiCandidateStatus,
} from './repository.js';
import {
  SimRationaleSchema,
  type RsiArtifactKind,
  type RsiCapabilityCandidate,
  type RsiCapabilityTelemetry,
  type RsiScopeType,
  type RsiStagedPayload,
  type SimRationale,
} from './types.js';
import { recordCapabilityOutcome } from './telemetry.js';
import { verifyRsiCandidate } from './verifier.js';
import { currentRsiProjectSkillMarkdown, isLegacyRsiProjectSkillCopy, rsiProjectSkillFile, rsiSkillContentHash } from './skill-installations.js';

const log = createLogger('RsiCapability');

const SynthesizedSkillResponseSchema = z.object({
  skillName: z.string().trim().min(2).max(64),
  description: z.string().trim().min(6).max(360),
  skillMarkdownBody: z.string().trim().min(20).max(40_000),
  simRationale: SimRationaleSchema,
}).strict();

function slugifySkillName(raw: string): string {
  const normalized = raw
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 48);
  return normalized && /^[a-z0-9]/u.test(normalized) ? normalized : `learned-skill-${ normalized || 'workflow' }`;
}

export function buildFormattedSkillMarkdown(input: {
  skillName: string;
  description: string;
  body: string;
  sim: SimRationale;
}): string {
  const safeDesc = input.description.replace(/\r?\n/gu, ' ').replace(/"/gu, "'").trim();
  return [
    '---',
    `name: ${input.skillName}`,
    `description: "${safeDesc}"`,
    '---',
    '',
    `# ${input.skillName}`,
    '',
    '## Overview',
    input.body.trim(),
    '',
    '## Applicability Conditions',
    ...input.sim.applicabilityConditions.map(item => `- ${item}`),
    '',
    '## Boundaries & Anti-Patterns',
    ...input.sim.negativeConstraints.map(item => `- ${item}`),
    '',
    '## Self-Improvement Rationale (SIM)',
    `- **Trigger Pattern**: ${input.sim.problemPattern}`,
    `- **Why Adopted**: ${input.sim.whyChanged}`,
    '',
  ].join('\n');
}

function summarizeEditDelta(originalDraft: string, editedDraft: string): {
  addedLines: string[];
  removedLines: string[];
} {
  const origSet = new Set(originalDraft.split(/\r?\n/u).map(l => l.trim()).filter(Boolean));
  const editSet = new Set(editedDraft.split(/\r?\n/u).map(l => l.trim()).filter(Boolean));
  const addedLines = [...editSet].filter(line => !origSet.has(line)).slice(0, 12);
  const removedLines = [...origSet].filter(line => !editSet.has(line)).slice(0, 12);
  return { addedLines, removedLines };
}

export interface RsiServiceDeps {
  ownerId?: string;
  getConfig: () => Config;
  resolveWorkspacePath: () => string;
  stagingRootDir?: string;
  onPublishEvent?: (type: string, payload: unknown) => void;
  synthesizeSkill?: (input: {
    triggerKind: 'recovered_failure' | 'human_edit_diff' | 'repeated_pattern';
    title: string;
    evidenceSummary: string;
    existingSkillMarkdown?: string;
  }) => Promise<z.infer<typeof SynthesizedSkillResponseSchema>>;
  now?: () => number;
}

function normalizePatternStem(title: string): string {
  return title
    .toLowerCase()
    .replace(/\b20\d{2}[-/.]\d{1,2}(?:[-/.]\d{1,2})?\b/gu, '')
    .replace(/[#v]\d+(?:\.\d+)*/giu, '')
    .replace(/\d+/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .slice(0, 80);
}

export class RsiCapabilityService {
  private readonly learnedRuns = new DurableState<number>('rsi.learned-task-runs');
  private readonly learnedPatternClusters = new DurableState<number>('rsi.learned-pattern-clusters');

  constructor(private readonly deps: RsiServiceDeps) {}

  private ownerId(): string {
    return resolvePersonalOwnerId(this.deps.ownerId);
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private stagingRoot(): string {
    return this.deps.stagingRootDir ?? join(resolveSkillsDir(), '..', 'skills-staging');
  }

  private targetSkillDir(scopeType: RsiScopeType, scopeId: string | undefined, skillName: string): string {
    if (scopeType === 'workspace') {
      return join(resolveWorkspaceSkillsRoot(scopeId ?? this.deps.resolveWorkspacePath()), skillName);
    }
    return join(resolveGlobalSkillsRoot(), skillName);
  }

  private previousSkillMarkdown(scopeType: RsiScopeType, scopeId: string | undefined, name: string): string | undefined {
    if (scopeType === 'project') return scopeId ? currentRsiProjectSkillMarkdown(scopeId, name) : undefined;
    const file = join(this.targetSkillDir(scopeType, scopeId, name), 'SKILL.md');
    if (!existsSync(file)) return undefined;
    const markdown = readFileSync(file, 'utf8');
    if (scopeType === 'workspace' && isLegacyRsiProjectSkillCopy(name, file, rsiSkillContentHash(markdown))) {
      return undefined;
    }
    return markdown;
  }

  /**
   * Consumes human resolutions from ProactiveHub:
   * 1. `mute_rule` -> synthesizes, verifies, and adopts a 0-Token Gate 1 filter rule.
   * 2. `edit_and_approve` -> extracts human edit diff into a verified Skill candidate in Inbox.
   */
  async handleProactiveItemResolved(item: ProactiveItem): Promise<RsiCapabilityCandidate | null> {
    const resolution = item.humanResolution;
    if (!resolution) return null;

    if (resolution.action === 'mute_rule') {
      return this.synthesizeMuteFilterRule(item);
    }

    if (
      resolution.action === 'edit_and_approve'
      && resolution.originalDraft
      && resolution.editedDraft
      && resolution.originalDraft.trim() !== resolution.editedDraft.trim()
    ) {
      return this.synthesizeFromHumanEditDiff(item, resolution.originalDraft, resolution.editedDraft);
    }

    return null;
  }

  private async synthesizeMuteFilterRule(item: ProactiveItem): Promise<RsiCapabilityCandidate | null> {
    const now = this.now();
    const ownerId = this.ownerId();
    const resolution = item.humanResolution!;
    const route = resolution.muteMode ?? 'drop';
    const filterText = resolution.senderOrSubjectFilter?.trim();
    const projectId = item.provenance.matchedProjectId;

    const stagedPayload: RsiStagedPayload = {
      kind: 'filter_rule',
      sourcePattern: item.provenance.source,
      eventTypePattern: item.provenance.eventType,
      matchPredicates: filterText
        ? { contains: { subject: filterText } }
        : { equals: { eventType: item.provenance.eventType } },
      defaultRoute: route,
      coalesceWindowMs: 300_000,
    };

    // For protected temporal sources, ensure a narrow predicate exists using item title if none supplied.
    if (
      route === 'drop'
      && item.provenance.source === 'temporal:calendar'
      && !filterText
    ) {
      stagedPayload.matchPredicates = { contains: { title: item.title.slice(0, 60) } };
    } else if (!filterText) {
      stagedPayload.matchPredicates = {};
    }

    const simRationale: SimRationale = {
      problemPattern: `Noisy proactive signal from ${item.provenance.source} (${item.provenance.eventType})`,
      whyChanged: `Owner explicitly muted/demoted item "${item.title}" to route=${route}`,
      applicabilityConditions: [`Incoming event matches ${item.provenance.source} / ${item.provenance.eventType}`],
      negativeConstraints: ['Does not suppress unrelated connector or explicit user reminders'],
      preservedInvariants: [],
    };

    const contentHash = createHash('sha256').update(JSON.stringify(stagedPayload)).digest('hex');
    const targetId = `filter-${item.provenance.source.replace(/[^a-z0-9-]+/giu, '-')}-${contentHash.slice(0, 8)}`;
    const { candidate } = saveRsiCandidate({
      ownerId,
      artifactKind: 'filter_rule',
      targetId,
      scopeType: projectId ? 'project' : 'workspace',
      scopeId: projectId ?? this.deps.resolveWorkspacePath(),
      triggerKind: 'triage_mute',
      dedupeKey: projectId ? `mute:${ownerId}:project:${projectId}:${contentHash}` : `mute:${ownerId}:${contentHash}`,
      sourceRefs: [`proactive_item:${item.id}`],
      simRationale,
      stagedContentUri: `sqlite://rsi_capability_candidates/${targetId}`,
      stagedPayload,
      contentHash,
      now,
    });

    const report = await verifyRsiCandidate(candidate, this.stagingRoot(), now);
    const verified = recordRsiVerificationResult(ownerId, candidate.id, report, undefined, now);
    if (!report.overallPassed) {
      log.warn({ candidateId: candidate.id, report, phase: 'verify_mute_rule' }, 'Rejected unsafe mute filter rule');
      return verified;
    }

    // Explicit owner mute is immediately adopted into Gate 1 with full rollback lineage.
    return this.adoptCandidate(ownerId, candidate.id, now);
  }

  private async synthesizeFromHumanEditDiff(
    item: ProactiveItem,
    originalDraft: string,
    editedDraft: string,
  ): Promise<RsiCapabilityCandidate | null> {
    const now = this.now();
    const ownerId = this.ownerId();
    const delta = summarizeEditDelta(originalDraft, editedDraft);
    if (delta.addedLines.length === 0 && delta.removedLines.length === 0) return null;

    const scopeType: RsiScopeType = item.provenance.matchedProjectId ? 'project' : 'workspace';
    const scopeId = item.provenance.matchedProjectId ?? this.deps.resolveWorkspacePath();

    const evidenceSummary = JSON.stringify({
      category: item.category,
      title: item.title,
      addedByHuman: delta.addedLines,
      removedByHuman: delta.removedLines,
      finalApprovedSample: editedDraft.slice(0, 1_500),
    });

    const synthesized = await this.buildSkillProposal({
      triggerKind: 'human_edit_diff',
      defaultName: slugifySkillName(`${item.category}-draft-standard`),
      title: item.title,
      evidenceSummary,
      fallbackSim: {
        problemPattern: `Draft preparation for "${item.category}" required human structural/content edits before approval`,
        whyChanged: `Incorporated ${delta.addedLines.length} owner-added constraint(s) and removed ${delta.removedLines.length} unwanted line(s)`,
        applicabilityConditions: [
          `Preparing "${item.category}" deliverables within ${scopeType} scope`,
        ],
        negativeConstraints: [
          'Do not apply this formatting template to unrelated casual chat replies',
          'Never treat past draft text as authorization to send without confirmation',
        ],
        preservedInvariants: [],
      },
      fallbackBody: [
        `When preparing **${item.category}** outputs similar to "${item.title}", follow these owner-verified standards:`,
        '',
        '### Required Additions & Structure',
        ...(delta.addedLines.length ? delta.addedLines.map(l => `- Include pattern/constraint: \`${l.slice(0, 200)}\``) : ['- Follow concise actionable formatting.']),
        ...(delta.removedLines.length ? ['', '### Patterns to Avoid', ...delta.removedLines.map(l => `- Avoid phrasing/step: \`${l.slice(0, 200)}\``)] : []),
      ].join('\n'),
      scopeType,
      scopeId,
    });

    return this.stageVerifyAndPublishSkill({
      ownerId,
      scopeType,
      scopeId,
      triggerKind: 'human_edit_diff',
      dedupeKey: `edit_diff:${ownerId}:${item.id}:${createHash('sha256').update(editedDraft).digest('hex').slice(0, 16)}`,
      sourceRefs: [`proactive_item:${item.id}`],
      proposal: synthesized,
      now,
    });
  }

  /**
   * Scans verified succeeded TaskRuns that recovered from prior failed attempts/errors
   * and extracts reusable troubleshooting / execution Skills.
   */
  async scanRecoveredTaskFailures(limit = 5): Promise<RsiCapabilityCandidate[]> {
    const db = getSqliteDatabase();
    const now = this.now();
    const ownerId = this.ownerId();

    type RecoveredRow = {
      run_id: string;
      task_id: string;
      project_id: string | null;
      title: string;
      summary: string;
      verification_json: string;
      prior_error: string | null;
    };

    const rows = db.prepare(`
      SELECT
        receipt.run_id,
        run.task_id,
        task.project_id,
        task.title,
        receipt.summary,
        receipt.verification_json,
        (
          SELECT COALESCE(prior_r.summary, prior.status)
          FROM task_runs prior
          LEFT JOIN task_run_receipts prior_r ON prior_r.run_id = prior.run_id
          WHERE prior.task_id = run.task_id
            AND prior.run_id != run.run_id
            AND prior.queued_at <= run.queued_at
            AND prior.status IN ('failed', 'cancelled')
          ORDER BY prior.queued_at DESC
          LIMIT 1
        ) AS prior_error
      FROM task_run_receipts receipt
      JOIN task_runs run ON run.run_id = receipt.run_id
      JOIN tasks task ON task.task_id = run.task_id
      WHERE receipt.status = 'succeeded'
        AND receipt.completion_verdict = 'achieved'
        AND EXISTS (
          SELECT 1 FROM task_runs prior
          WHERE prior.task_id = run.task_id
            AND prior.run_id != run.run_id
            AND prior.queued_at <= run.queued_at
            AND prior.status = 'failed'
        )
      ORDER BY receipt.finalized_at DESC
      LIMIT ?
    `).all(Math.max(1, Math.min(limit, 20))) as unknown as RecoveredRow[];

    const produced: RsiCapabilityCandidate[] = [];
    for (const row of rows) {
      if (this.learnedRuns.get(row.run_id) !== undefined) continue;
      this.learnedRuns.set(row.run_id, now);

      const scopeType: RsiScopeType = row.project_id ? 'project' : 'workspace';
      const scopeId = row.project_id ?? this.deps.resolveWorkspacePath();
      const skillName = slugifySkillName(`recovery-${row.title}`);

      const proposal = await this.buildSkillProposal({
        triggerKind: 'recovered_failure',
        defaultName: skillName,
        title: row.title,
        evidenceSummary: JSON.stringify({
          taskTitle: row.title,
          priorFailure: (row.prior_error ?? 'Initial execution failed').slice(0, 800),
          verifiedRecoverySummary: row.summary.slice(0, 1_600),
          verification: row.verification_json.slice(0, 800),
        }),
        fallbackSim: {
          problemPattern: `Task "${row.title}" initially failed (${(row.prior_error ?? 'execution error').slice(0, 180)}) before recovering`,
          whyChanged: `Captured verified recovery procedure from run ${row.run_id} so future runs avoid repeating the failed attempt`,
          applicabilityConditions: [`Executing tasks matching "${row.title.slice(0, 80)}" in ${scopeType} scope`],
          negativeConstraints: [
            'Do not skip verification criteria after applying recovery steps',
            'Do not apply outside matching workspace/project environment',
          ],
          preservedInvariants: [],
        },
        fallbackBody: [
          `Verified execution & recovery playbook extracted from succeeded run \`${row.run_id}\`:`,
          '',
          '### Known Pitfall',
          `- Previous failure mode: ${(row.prior_error ?? 'Initial attempt failed').slice(0, 400)}`,
          '',
          '### Verified Resolution Procedure',
          row.summary.slice(0, 1_500),
        ].join('\n'),
        scopeType,
        scopeId,
      });

      const candidate = await this.stageVerifyAndPublishSkill({
        ownerId,
        scopeType,
        scopeId,
        triggerKind: 'recovered_failure',
        dedupeKey: `recovered:${ownerId}:${row.task_id}:${row.run_id}`,
        sourceRefs: [`task_run:${row.run_id}`, `task:${row.task_id}`],
        proposal,
        now,
      });
      if (candidate) produced.push(candidate);
    }
    return produced;
  }

  /**
   * Milestone 4: Cross-session / cross-task recurring pattern miner.
   * Identifies verified succeeded tasks sharing a recurring normalized workflow stem (>= 3 runs)
   * and synthesizes a reusable standard Skill candidate.
   */
  async scanRepeatedPatterns(minOccurrences = 3): Promise<RsiCapabilityCandidate[]> {
    const db = getSqliteDatabase();
    const now = this.now();
    const ownerId = this.ownerId();

    type SucceededRow = {
      run_id: string;
      task_id: string;
      project_id: string | null;
      title: string;
      summary: string;
    };

    const rows = db.prepare(`
      SELECT receipt.run_id, run.task_id, task.project_id, task.title, receipt.summary
      FROM task_run_receipts receipt
      JOIN task_runs run ON run.run_id = receipt.run_id
      JOIN tasks task ON task.task_id = run.task_id
      WHERE receipt.status = 'succeeded' AND receipt.completion_verdict = 'achieved'
      ORDER BY receipt.finalized_at DESC
      LIMIT 100
    `).all() as unknown as SucceededRow[];

    const groups = new Map<string, SucceededRow[]>();
    for (const row of rows) {
      const stem = normalizePatternStem(row.title);
      if (stem.length < 4) continue;
      const bucket = groups.get(stem) ?? [];
      if (!bucket.some(item => item.run_id === row.run_id)) {
        bucket.push(row);
        groups.set(stem, bucket);
      }
    }

    const threshold = Math.max(3, minOccurrences);
    const produced: RsiCapabilityCandidate[] = [];

    for (const [stem, cluster] of groups.entries()) {
      if (cluster.length < threshold) continue;
      const clusterSignature = createHash('sha256')
        .update(`${stem}:${cluster.slice(0, 5).map(r => r.run_id).sort().join(',')}`)
        .digest('hex')
        .slice(0, 16);
      if (this.learnedPatternClusters.get(clusterSignature) !== undefined) continue;
      this.learnedPatternClusters.set(clusterSignature, now);

      const distinctProjects = new Set(cluster.map(r => r.project_id).filter(Boolean));
      const scopeType: RsiScopeType = distinctProjects.size >= 2
        ? 'global'
        : distinctProjects.size === 1
          ? 'project'
          : 'workspace';
      const scopeId = scopeType === 'project'
        ? [...distinctProjects][0]!
        : scopeType === 'workspace'
          ? this.deps.resolveWorkspacePath()
          : undefined;

      const skillName = slugifySkillName(`playbook-${stem}`);
      const sampleSummaries = cluster.slice(0, 4).map((r, idx) => `${idx + 1}. ${r.summary.slice(0, 400)}`);
      const sourceRefs = cluster.slice(0, 5).map(r => `task_run:${r.run_id}`);

      const proposal = await this.buildSkillProposal({
        triggerKind: 'repeated_pattern',
        defaultName: skillName,
        title: cluster[0]!.title,
        evidenceSummary: JSON.stringify({
          patternStem: stem,
          occurrences: cluster.length,
          verifiedSummaries: sampleSummaries,
        }),
        fallbackSim: {
          problemPattern: `Recurring task workflow "${stem}" executed manually ${cluster.length} times across independent runs`,
          whyChanged: `Consolidated ${cluster.length} verified completions into a standardized reusable playbook`,
          applicabilityConditions: [
            `Executing recurring requests matching "${stem}"`,
          ],
          negativeConstraints: [
            'Do not bypass task-specific user overrides when present',
            'Never auto-execute external side effects without confirmation',
          ],
          preservedInvariants: [],
        },
        fallbackBody: [
          `Standardized execution playbook distilled from ${cluster.length} verified runs of **${cluster[0]!.title}**:`,
          '',
          '### Standard Execution Steps',
          ...sampleSummaries,
        ].join('\n'),
        scopeType,
        scopeId,
      });

      const candidate = await this.stageVerifyAndPublishSkill({
        ownerId,
        scopeType,
        scopeId,
        triggerKind: 'repeated_pattern',
        dedupeKey: `pattern:${ownerId}:${stem}:${clusterSignature}`,
        sourceRefs,
        proposal,
        now,
      });
      if (candidate) produced.push(candidate);
    }

    return produced;
  }

  private async buildSkillProposal(input: {
    triggerKind: 'recovered_failure' | 'human_edit_diff' | 'repeated_pattern';
    defaultName: string;
    title: string;
    evidenceSummary: string;
    fallbackSim: SimRationale;
    fallbackBody: string;
    scopeType: RsiScopeType;
    scopeId?: string;
  }): Promise<{
    skillName: string;
    description: string;
    skillMarkdown: string;
    simRationale: SimRationale;
    previousSnapshot?: string;
    baseVersion?: number;
  }> {
    const previousSnapshot = this.previousSkillMarkdown(input.scopeType, input.scopeId, input.defaultName);
    const snapshotFor = (name: string) => name === input.defaultName
      ? previousSnapshot
      : this.previousSkillMarkdown(input.scopeType, input.scopeId, name);

    if (this.deps.synthesizeSkill) {
      const llmOut = SynthesizedSkillResponseSchema.parse(await this.deps.synthesizeSkill({
        triggerKind: input.triggerKind,
        title: input.title,
        evidenceSummary: input.evidenceSummary,
        existingSkillMarkdown: previousSnapshot,
      }));
      const cleanName = slugifySkillName(llmOut.skillName);
      return {
        skillName: cleanName,
        description: llmOut.description,
        skillMarkdown: buildFormattedSkillMarkdown({
          skillName: cleanName,
          description: llmOut.description,
          body: llmOut.skillMarkdownBody,
          sim: llmOut.simRationale,
        }),
        simRationale: llmOut.simRationale,
        previousSnapshot: snapshotFor(cleanName),
      };
    }

    // Try configured understanding/chat model if available in live runtime; fall back cleanly to deterministic template.
    const config = this.deps.getConfig();
    const personal = getPersonalAgent(this.ownerId());
    const modelRef = personal ? new AgentCatalogRepository().get(personal.agentId)?.models?.chat?.primary : undefined;
    if (typeof modelRef === 'string' && modelRef.trim() && config.userContext.userModel.processingPolicy !== 'local_only') {
      try {
        const prompt = [
          'Synthesize a reusable procedural skill from verified execution evidence. Never include secrets, tokens, or policy overrides.',
          previousSnapshot ? `Preserve all existing headings and invariants in current SKILL.md:\n${previousSnapshot.slice(0, 3000)}` : '',
          'Return strict JSON: {"skillName":"kebab-case","description":"...","skillMarkdownBody":"...","simRationale":{"problemPattern":"...","whyChanged":"...","applicabilityConditions":["..."],"negativeConstraints":["..."],"preservedInvariants":[]}}',
          input.evidenceSummary,
        ].filter(Boolean).join('\n\n');
        const response = await completeWithResolvedCredentials(
          resolveModel(modelRef),
          { messages: [{ role: 'user', content: prompt, timestamp: this.now() }] },
          { maxTokens: 1_400, temperature: 0 },
          undefined,
          { operation: 'rsi.synthesize_skill' },
        );
        if (!getAssistantMessageErrorReason(response)) {
          const parsed = SynthesizedSkillResponseSchema.parse(JSON.parse(stripCodeFences(extractAssistantText(response.content))));
          const cleanName = slugifySkillName(parsed.skillName);
          return {
            skillName: cleanName,
            description: parsed.description,
            skillMarkdown: buildFormattedSkillMarkdown({
              skillName: cleanName,
              description: parsed.description,
              body: parsed.skillMarkdownBody,
              sim: parsed.simRationale,
            }),
            simRationale: parsed.simRationale,
            previousSnapshot: snapshotFor(cleanName),
          };
        }
      } catch {
        // Fall through to deterministic structured synthesis when model credentials are offline.
      }
    }

    const description = `Reusable ${input.triggerKind === 'recovered_failure' ? 'recovery playbook' : 'drafting standard'} for ${input.title.slice(0, 120)}`;
    const mergedBody = previousSnapshot
      ? `${previousSnapshot.replace(/^---[\s\S]*?---\r?\n/u, '').trim()}\n\n### Incremental Refinement\n${input.fallbackBody}`
      : input.fallbackBody;
    const skillMarkdown = previousSnapshot
      ? [
        '---',
        `name: ${input.defaultName}`,
        `description: "${description.replace(/"/gu, "'")}"`,
        '---',
        '',
        mergedBody,
        '',
      ].join('\n')
      : buildFormattedSkillMarkdown({
        skillName: input.defaultName,
        description,
        body: input.fallbackBody,
        sim: input.fallbackSim,
      });

    return {
      skillName: input.defaultName,
      description,
      skillMarkdown,
      simRationale: input.fallbackSim,
      previousSnapshot,
    };
  }

  private async stageVerifyAndPublishSkill(input: {
    ownerId: string;
    scopeType: RsiScopeType;
    scopeId?: string;
    triggerKind: 'recovered_failure' | 'human_edit_diff' | 'repeated_pattern';
    dedupeKey: string;
    sourceRefs: string[];
    proposal: {
      skillName: string;
      description: string;
      skillMarkdown: string;
      simRationale: SimRationale;
      previousSnapshot?: string;
    };
    now: number;
  }): Promise<RsiCapabilityCandidate> {
    const candidateId = randomUUID();
    const stagedDir = join(this.stagingRoot(), candidateId, input.proposal.skillName);
    const stagedUri = join(stagedDir, 'SKILL.md');
    const stagedPayload: RsiStagedPayload = {
      kind: 'skill',
      skillName: input.proposal.skillName,
      description: input.proposal.description,
      skillMarkdown: input.proposal.skillMarkdown,
    };
    const contentHash = createHash('sha256').update(input.proposal.skillMarkdown).digest('hex');
    const priorVersion = currentRsiSkillVersion(input.proposal.skillName, input.scopeType, input.scopeId);

    const { candidate, created } = saveRsiCandidate({
      id: candidateId,
      ownerId: input.ownerId,
      artifactKind: 'skill',
      targetId: input.proposal.skillName,
      ...(priorVersion > 0 ? { baseVersion: priorVersion } : {}),
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      triggerKind: input.triggerKind,
      dedupeKey: input.dedupeKey,
      sourceRefs: input.sourceRefs,
      simRationale: input.proposal.simRationale,
      stagedContentUri: stagedUri,
      stagedPayload,
      contentHash,
      previousContentSnapshot: input.proposal.previousSnapshot,
      now: input.now,
    });
    if (!created) return candidate;

    const report = await verifyRsiCandidate(candidate, this.stagingRoot(), input.now);
    if (!report.overallPassed) {
      log.info({
        candidateId: candidate.id,
        skillName: input.proposal.skillName,
        gateA: report.gateA_security.reasons,
        gateB: report.gateB_capabilityPreservation.reasons,
        gateC: report.gateC_scopeAndAuthority.reasons,
      }, 'RSI skill candidate blocked by verification gates');
      return recordRsiVerificationResult(input.ownerId, candidate.id, report, undefined, input.now);
    }

    const personal = getPersonalAgent(input.ownerId);
    const inboxCard = saveProactiveItem({
      ownerId: input.ownerId,
      agentId: personal?.agentId ?? 'main',
      coalesceKey: input.scopeType === 'project'
        ? `rsi:skill:project:${input.scopeId}:${input.proposal.skillName}`
        : `rsi:skill:${input.proposal.skillName}`,
      sourceEventIds: input.sourceRefs,
      tier: 'tier_a_inbox',
      category: 'skill_candidate',
      title: priorVersion > 0
        ? `技能升级建议：${input.proposal.skillName}（当前 v${priorVersion}）`
        : `新技能沉淀建议：${input.proposal.skillName}`,
      summary: `${input.proposal.simRationale.whyChanged}（已通过安全与能力保持三道门禁校验）`,
      provenance: {
        source: 'rsi:synthesizer',
        eventType: `rsi.${input.triggerKind}`,
        trust: 'system',
        coalescedCount: input.sourceRefs.length,
        reason: input.proposal.simRationale.problemPattern,
        evidenceRefs: input.sourceRefs,
        score: {
          actionability: 2,
          urgency: 1,
          novelty: 2,
          preparedness: 2,
          disruptionPenalty: 0,
          netScore: 9,
        },
      },
      preparedPayload: {
        verifiedFacts: [
          `作用域：${input.scopeType}${input.scopeId ? ` (${input.scopeId})` : ''}`,
          `适用条件：${input.proposal.simRationale.applicabilityConditions.join('；')}`,
          `边界约束：${input.proposal.simRationale.negativeConstraints.join('；')}`,
        ],
        evidenceRefs: input.sourceRefs,
        preparedDraft: input.proposal.skillMarkdown,
        proposedAction: {
          kind: 'adopt_rsi_candidate',
          safetyMode: 'ask_before_apply',
          label: '采纳并启用该技能',
          targetRef: candidate.id,
        },
      },
      proposedAction: {
        kind: 'adopt_rsi_candidate',
        safetyMode: 'ask_before_apply',
        label: '采纳并启用该技能',
        targetRef: candidate.id,
      },
      state: 'ready',
      idempotencyKey: `rsi:inbox:${candidate.id}`,
      validUntil: input.now + 14 * 86_400_000,
      now: input.now,
    });

    const updated = recordRsiVerificationResult(input.ownerId, candidate.id, report, inboxCard.id, input.now);
    this.deps.onPublishEvent?.('rsi.candidate.ready', { candidateId: updated.id, proactiveItemId: inboxCard.id });
    this.deps.onPublishEvent?.('proactive.inbox.updated', { itemId: inboxCard.id, tier: 'tier_a_inbox', state: 'ready' });
    return updated;
  }

  /**
   * Atomically adopts a verified RSI candidate, snapshotting prior live state so
   * `rollbackCandidate` can restore it cleanly at any time.
   */
  adoptCandidate(
    ownerId: string,
    candidateId: string,
    now = this.now(),
  ): RsiCapabilityCandidate {
    return runSqliteWriteTransaction(db => {
      const candidate = getRsiCandidate(ownerId, candidateId);
      if (!candidate) throw new Error('RSI candidate not found');
      if (candidate.status === 'adopted') return candidate;
      if (candidate.verificationStatus !== 'passed') {
        throw new Error('Cannot adopt an unverified or failed RSI candidate');
      }
      if (candidate.status === 'rejected' || candidate.status === 'rolled_back') {
        throw new Error(`Cannot adopt candidate in status "${candidate.status}"`);
      }

      const payload = candidate.stagedPayload;
      const version = nextAdoptedCapabilityVersion(candidate.artifactKind, candidate.targetId);
      if (candidate.scopeType === 'project' && (!candidate.scopeId
        || !db.prepare('SELECT 1 FROM projects WHERE project_id = ?').get(candidate.scopeId))) {
        throw new Error('The RSI candidate project is no longer available');
      }
      const projectId = candidate.scopeType === 'project' ? candidate.scopeId : undefined;
      const skillPath = payload.kind !== 'skill' ? undefined : projectId
        ? rsiProjectSkillFile(projectId, candidate.id, payload.skillName)
        : join(this.targetSkillDir(candidate.scopeType, candidate.scopeId, payload.skillName), 'SKILL.md');
      const liveSnapshot = payload.kind === 'skill' && projectId
        ? currentRsiProjectSkillMarkdown(projectId, payload.skillName)
        : skillPath && existsSync(skillPath) ? readFileSync(skillPath, 'utf8') : candidate.previousContentSnapshot;

      if (payload.kind === 'filter_rule') {
        const subId = `rsi:${candidate.id}`;
        const existingSub = listProactiveSubscriptions(ownerId).find(s => s.id === subId);
        if (!existingSub) {
          createProactiveSubscription(ownerId, {
            scopeType: candidate.scopeType === 'project' ? 'project' : candidate.scopeType === 'workspace' ? 'workspace' : 'global',
            scopeId: candidate.scopeId,
            sourcePattern: payload.sourcePattern,
            eventTypePattern: payload.eventTypePattern,
            matchPredicates: payload.matchPredicates,
            defaultRoute: payload.defaultRoute,
            coalesceWindowMs: payload.coalesceWindowMs,
            enabled: true,
          }, 'rsi_adopted', now, subId);
        }
      }

      ensureRsiTelemetryVersion(candidate.artifactKind, candidate.targetId, version);
      const adopted = transitionRsiCandidateStatus({
        ownerId,
        candidateId,
        status: 'adopted',
        adoptedVersion: version,
        previousContentSnapshot: liveSnapshot,
        now,
      });

      if (adopted.proactiveItemId) {
        db.prepare("UPDATE proactive_items SET state = 'acted', updated_at = ? WHERE id = ? AND owner_id = ?")
          .run(now, adopted.proactiveItemId, ownerId);
      }
      if (skillPath && payload.kind === 'skill') {
        writeTextAtomicSync(skillPath, payload.skillMarkdown);
      }
      afterSqliteCommit(() => this.deps.onPublishEvent?.('rsi.candidate.adopted', {
        candidateId: adopted.id,
        artifactKind: adopted.artifactKind,
        targetId: adopted.targetId,
        version,
      }));
      return adopted;
    });
  }

  rejectCandidate(ownerId: string, candidateId: string, now = this.now()): RsiCapabilityCandidate {
    const candidate = getRsiCandidate(ownerId, candidateId);
    if (!candidate) throw new Error('RSI candidate not found');
    if (candidate.status === 'adopted') {
      throw new Error('Adopted candidate must be rolled back instead of rejected');
    }
    const rejected = transitionRsiCandidateStatus({ ownerId, candidateId, status: 'rejected', now });
    if (rejected.proactiveItemId) {
      getSqliteDatabase()
        .prepare("UPDATE proactive_items SET state = 'acted', updated_at = ? WHERE id = ? AND owner_id = ?")
        .run(now, rejected.proactiveItemId, ownerId);
    }
    return rejected;
  }

  /**
   * Restores the exact pre-adoption snapshot (or removes a newly created skill / disables a filter rule).
   */
  async rollbackCandidate(ownerId: string, candidateId: string, now = this.now()): Promise<RsiCapabilityCandidate> {
    const candidate = getRsiCandidate(ownerId, candidateId);
    if (!candidate) throw new Error('RSI candidate not found');
    if (candidate.status === 'rolled_back') return candidate;
    if (candidate.status !== 'adopted') {
      throw new Error('Only adopted RSI candidates can be rolled back');
    }

    if (candidate.stagedPayload.kind === 'skill' && candidate.scopeType !== 'project') {
      const skillDir = this.targetSkillDir(candidate.scopeType, candidate.scopeId, candidate.stagedPayload.skillName);
      const skillMdPath = join(skillDir, 'SKILL.md');
      if (candidate.previousContentSnapshot !== undefined) {
        await mkdir(skillDir, { recursive: true });
        await writeFile(skillMdPath, candidate.previousContentSnapshot, 'utf8');
      } else {
        await rm(skillDir, { recursive: true, force: true });
      }
    } else if (candidate.stagedPayload.kind === 'filter_rule') {
      const subId = `rsi:${candidate.id}`;
      const existingSub = listProactiveSubscriptions(ownerId).find(s => s.id === subId);
      if (existingSub && existingSub.enabled) {
        patchProactiveSubscription(ownerId, subId, {
          expectedRevision: existingSub.revision,
          enabled: false,
        }, now);
      }
    }

    const rolledBack = transitionRsiCandidateStatus({ ownerId, candidateId, status: 'rolled_back', now });
    this.deps.onPublishEvent?.('rsi.candidate.rolled_back', {
      candidateId: rolledBack.id,
      artifactKind: rolledBack.artifactKind,
      targetId: rolledBack.targetId,
    });
    return rolledBack;
  }

  /**
   * Records real post-adoption telemetry and emits a rollback alert into Inbox if
   * failure + human-override rate crosses the degradation threshold (>= 60% over >= 3 runs).
   */
  recordCapabilityOutcome(input: {
    capabilityKind: RsiArtifactKind;
    targetId: string;
    version: number;
    outcome: 'verified_success' | 'failure' | 'human_edited';
  }): RsiCapabilityTelemetry {
    return recordCapabilityOutcome({ ...input, ownerId: this.ownerId(), now: this.now() });
  }
}
