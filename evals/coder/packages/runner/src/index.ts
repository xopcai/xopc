import { createHash, randomUUID } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

import { runGrader } from '@agent-evals/graders';
import {
  redactSensitive,
  redactText,
  TraceEmitter,
  type AgentAdapter,
  type AgentRunResult,
  type AgentVariant,
  type EvalCase,
  type EvalRunResult,
  type EvalSuite,
  type ExperimentSpec,
  type GradeResult,
  type GraderSpec,
  type RepoSpec,
  type RunRequest,
} from '@agent-evals/protocol';
import { GitCloneSandbox } from '@agent-evals/sandbox';
import { ArtifactStore, EvalStore } from '@agent-evals/storage';
import { parse } from 'yaml';

interface RawSuite extends Omit<EvalSuite, 'sourcePath' | 'contentHash' | 'cases'> {
  cases: Array<Omit<EvalCase, 'repo'> & { repo: RepoSpec }>;
}

function tokenUsage(value: unknown, depth = 0): number {
  if (depth > 4 || !value || typeof value !== 'object') return 0;
  const record = value as Record<string, unknown>;
  if (record.usage && typeof record.usage === 'object') {
    const usage = record.usage as Record<string, unknown>;
    if (typeof usage.total === 'number') return usage.total;
    const input = typeof usage.input === 'number' ? usage.input : 0;
    const output = typeof usage.output === 'number' ? usage.output : 0;
    if (input || output) return input + output;
  }
  let total = 0;
  for (const child of Object.values(record)) total += tokenUsage(child, depth + 1);
  return total;
}

function expandEnvironment(value: string): string {
  return value.replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, (_match, name: string) => {
    const replacement = process.env[name];
    if (!replacement) throw new Error(`Missing environment variable: ${name}`);
    return replacement;
  });
}

function orderedVariants(
  variants: AgentVariant[],
  seed: string,
  caseId: string,
  repetition: number,
  randomize: boolean,
): AgentVariant[] {
  if (!randomize || variants.length < 2) return [...variants];
  return [...variants].sort((left, right) => {
    const leftKey = createHash('sha256')
      .update(`${seed}\0${caseId}\0${repetition}\0${left.id}`)
      .digest('hex');
    const rightKey = createHash('sha256')
      .update(`${seed}\0${caseId}\0${repetition}\0${right.id}`)
      .digest('hex');
    return leftKey.localeCompare(rightKey);
  });
}

function assertSuite(value: unknown): asserts value is RawSuite {
  if (!value || typeof value !== 'object') throw new Error('Suite must be an object');
  const suite = value as Partial<RawSuite>;
  if (!suite.id || !suite.version || !Array.isArray(suite.cases) || suite.cases.length === 0) {
    throw new Error('Suite requires id, version, and at least one case');
  }
  const caseIds = new Set<string>();
  for (const evalCase of suite.cases) {
    if (!evalCase.id || !evalCase.task || !evalCase.repo?.commit || !evalCase.budget?.timeoutMs) {
      throw new Error('Each case requires id, task, repo.commit, and budget.timeoutMs');
    }
    if (!Array.isArray(evalCase.graders) || evalCase.graders.length === 0) {
      throw new Error(`Case ${evalCase.id} requires at least one grader`);
    }
    if (caseIds.has(evalCase.id)) throw new Error(`Duplicate case id: ${evalCase.id}`);
    caseIds.add(evalCase.id);
    for (const grader of evalCase.graders) {
      if (grader.weight !== undefined && (!Number.isFinite(grader.weight) || grader.weight < 0)) {
        throw new Error(`Case ${evalCase.id} has an invalid grader weight`);
      }
    }
  }
}

function assertExperiment(value: unknown): asserts value is ExperimentSpec {
  if (!value || typeof value !== 'object') throw new Error('Experiment must be an object');
  const experiment = value as Partial<ExperimentSpec>;
  if (!experiment.name || !Array.isArray(experiment.variants) || experiment.variants.length < 1) {
    throw new Error('Experiment requires name and at least one variant');
  }
  if (
    experiment.repetitions !== undefined &&
    (!Number.isInteger(experiment.repetitions) || experiment.repetitions < 1)
  ) {
    throw new Error('Experiment repetitions must be a positive integer');
  }
  const ids = new Set<string>();
  for (const variant of experiment.variants) {
    if (!variant.id || !variant.adapter) throw new Error('Each variant requires id and adapter');
    if (ids.has(variant.id)) throw new Error(`Duplicate variant id: ${variant.id}`);
    ids.add(variant.id);
  }
}

export async function loadSuite(path: string): Promise<EvalSuite> {
  const absolute = resolve(path);
  const content = await readFile(absolute, 'utf8');
  const raw = parse(content) as unknown;
  assertSuite(raw);
  const suiteDir = dirname(absolute);
  const suiteRoot = await realpath(suiteDir);
  const cases = await Promise.all(raw.cases.map(async (evalCase) => {
    const repo = { ...evalCase.repo, commit: expandEnvironment(evalCase.repo.commit) };
    if (repo.path) {
      const environmentBacked = /\$\{[A-Z_][A-Z0-9_]*\}/.test(repo.path);
      const expanded = expandEnvironment(repo.path);
      repo.path = isAbsolute(expanded)
        ? expanded
        : environmentBacked
          ? resolve(expanded)
          : resolve(suiteDir, expanded);
    }
    if (repo.url) repo.url = expandEnvironment(repo.url);
    const graders = await Promise.all(evalCase.graders.map(async (grader): Promise<GraderSpec> => {
      if (grader.type !== 'command' || !grader.hiddenFiles) return grader;
      return {
        ...grader,
        hiddenFiles: await Promise.all(grader.hiddenFiles.map(async (file) => {
          const source = await realpath(resolve(suiteDir, file.source));
          const sourceRelative = relative(suiteRoot, source);
          if (
            source === suiteRoot ||
            sourceRelative.startsWith('..') ||
            isAbsolute(sourceRelative)
          ) {
            throw new Error(
              `Hidden grader source must stay inside the Suite directory: ${file.source}`,
            );
          }
          return { ...file, source };
        })),
      };
    }));
    return { ...evalCase, repo, graders };
  }));
  const fingerprint = createHash('sha256').update(content);
  for (const evalCase of cases) {
    fingerprint.update(evalCase.repo.commit);
    for (const grader of evalCase.graders) {
      if (grader.type !== 'command') continue;
      for (const file of grader.hiddenFiles ?? []) {
        fingerprint.update(file.target).update('\0').update(createHash('sha256').update(await readFile(file.source)).digest());
      }
    }
  }
  return {
    ...raw,
    cases,
    sourcePath: absolute,
    contentHash: fingerprint.digest('hex'),
  };
}

export async function loadExperiment(path: string): Promise<ExperimentSpec> {
  const content = await readFile(resolve(path), 'utf8');
  const raw = parse(content) as unknown;
  assertExperiment(raw);
  return { ...raw, variants: raw.variants.map(variant => ({
    ...variant,
    ...(variant.model ? { model: expandEnvironment(variant.model) } : {}),
    ...(variant.config ? { config: Object.fromEntries(Object.entries(variant.config).map(([key, value]) =>
      [key, typeof value === 'string' ? expandEnvironment(value) : value])) } : {}),
  })) };
}

export interface EvalRunnerOptions {
  store: EvalStore;
  artifactStore: ArtifactStore;
  adapters: Iterable<AgentAdapter>;
  keepWorkspaces?: boolean;
}

export class EvalRunner {
  private readonly store: EvalStore;
  private readonly artifactStore: ArtifactStore;
  private readonly adapters: Map<string, AgentAdapter>;
  private readonly sandbox = new GitCloneSandbox();
  private readonly keepWorkspaces: boolean;

  constructor(options: EvalRunnerOptions) {
    this.store = options.store;
    this.artifactStore = options.artifactStore;
    this.adapters = new Map([...options.adapters].map((adapter) => [adapter.id, adapter]));
    this.keepWorkspaces = options.keepWorkspaces ?? false;
  }

  async runExperiment(suite: EvalSuite, spec: ExperimentSpec): Promise<{
    experimentId: string;
    runs: EvalRunResult[];
  }> {
    const experimentId = randomUUID();
    const effectiveSpec: ExperimentSpec = {
      ...spec,
      randomizeVariantOrder: spec.randomizeVariantOrder ?? true,
      randomSeed: spec.randomSeed ?? randomUUID(),
    };
    this.store.createExperiment({
      id: experimentId,
      name: spec.name,
      suiteId: suite.id,
      suiteVersion: suite.version,
      suiteHash: suite.contentHash,
      spec: effectiveSpec,
    });
    const runs: EvalRunResult[] = [];
    let experimentFailed = false;
    try {
      for (let repetition = 0; repetition < (spec.repetitions ?? 1); repetition += 1) {
        for (const evalCase of suite.cases) {
          const variants = orderedVariants(
            effectiveSpec.variants,
            effectiveSpec.randomSeed!,
            evalCase.id,
            repetition,
            effectiveSpec.randomizeVariantOrder!,
          );
          for (const variant of variants) {
            const run = await this.runOne(experimentId, evalCase, variant, repetition);
            runs.push(run);
            if (
              run.status === 'error' ||
              run.status === 'timed_out' ||
              run.status === 'budget_exceeded'
            ) experimentFailed = true;
          }
        }
      }
      this.store.completeExperiment(experimentId, experimentFailed ? 'failed' : 'completed');
      return { experimentId, runs };
    } catch (error) {
      this.store.completeExperiment(experimentId, 'failed');
      throw error;
    }
  }

  private async runOne(
    experimentId: string,
    evalCase: EvalCase,
    variant: AgentVariant,
    repetition: number,
  ): Promise<EvalRunResult> {
    const runId = randomUUID();
    const adapter = this.adapters.get(variant.adapter);
    if (!adapter) throw new Error(`Unknown adapter: ${variant.adapter}`);
    const environment = await this.sandbox.prepare(evalCase);
    const resolvedCase: EvalCase = {
      ...evalCase,
      repo: {
        ...evalCase.repo,
        commit: environment.sourceCommit,
      },
    };
    const request: RunRequest = {
      runId,
      experimentId,
      evalCase: resolvedCase,
      variant,
      environment,
    };
    this.store.createRun({
      id: runId,
      experimentId,
      evalCase: resolvedCase,
      variantId: `${variant.id}${repetition ? `#${repetition + 1}` : ''}`,
      adapter: adapter.id,
      sourceCommit: environment.sourceCommit,
      fixtureCommit: environment.fixtureCommit,
    });

    const artifactRefs: string[] = [];
    const controller = new AbortController();
    let abortReason: 'timeout' | 'model_requests' | 'tokens' | undefined;
    let modelRequests = 0;
    let observedTokens = 0;
    let sawExplicitModelRequest = false;
    let eventSeq = 0;
    const persistEvent = (event: Parameters<EvalStore['appendEvent']>[0]) => {
      const safePayload = redactSensitive(event.payload) as Record<string, unknown>;
      if (event.type === 'model.request') {
        sawExplicitModelRequest = true;
        modelRequests += 1;
      }
      if (event.type === 'model.response') {
        const responseTokens = tokenUsage(safePayload);
        observedTokens += responseTokens;
        if (!sawExplicitModelRequest && responseTokens > 0) modelRequests += 1;
      }
      if (
        !controller.signal.aborted &&
        resolvedCase.budget.maxModelRequests !== undefined &&
        modelRequests > resolvedCase.budget.maxModelRequests
      ) {
        abortReason = 'model_requests';
        controller.abort();
      }
      if (
        !controller.signal.aborted &&
        resolvedCase.budget.maxTokens !== undefined &&
        observedTokens > resolvedCase.budget.maxTokens
      ) {
        abortReason = 'tokens';
        controller.abort();
      }
      const serialized = JSON.stringify(safePayload);
      if (serialized.length <= 12_000) {
        this.store.appendEvent({ ...event, seq: ++eventSeq, payload: safePayload });
        return;
      }
      const artifact = this.artifactStore.putText(
        runId,
        `trace-payload-${event.type}`,
        serialized,
        'application/json',
      );
      this.store.recordArtifact(artifact);
      artifactRefs.push(artifact.id);
      this.store.appendEvent({
        ...event,
        seq: ++eventSeq,
        payload: {
          truncated: true,
          originalChars: serialized.length,
          keys: Object.keys(safePayload),
        },
        artifactRefs: [...(event.artifactRefs ?? []), artifact.id],
      });
    };
    const runnerTrace = new TraceEmitter(runId, persistEvent);
    await runnerTrace.emit('environment.prepared', environment.metadata);
    const timer = setTimeout(() => {
      abortReason = 'timeout';
      controller.abort();
    }, resolvedCase.budget.timeoutMs);
    timer.unref?.();
    let agent: AgentRunResult = { status: 'failed', finalText: '', error: 'Run did not start' };

    try {
      await adapter.prepare?.(request);
      agent = await adapter.run(
        request,
        persistEvent,
        controller.signal,
      );
    } catch (error) {
      agent = {
        status: controller.signal.aborted ? 'aborted' : 'failed',
        finalText: '',
        error: error instanceof Error ? error.message : String(error),
      };
      await runnerTrace.emit('run.failed', { error: agent.error, abortReason });
      if (controller.signal.aborted) await adapter.abort?.(runId);
    } finally {
      clearTimeout(timer);
    }

    const grades: GradeResult[] = [];
    try {
      const diff = await this.sandbox.diff(environment.workspace);
      if (diff.trim()) {
        const artifact = this.artifactStore.putText(
          runId,
          'workspace-diff',
          redactText(diff),
          'text/x-diff',
        );
        this.store.recordArtifact(artifact);
        artifactRefs.push(artifact.id);
        await runnerTrace.emit('workspace.changed', {
          diffChars: diff.length,
        }, { artifactRefs: [artifact.id] });
      }

      for (let index = 0; index < resolvedCase.graders.length; index += 1) {
        const grader = resolvedCase.graders[index]!;
        await runnerTrace.emit('verification.started', { graderIndex: index, type: grader.type });
        const grade = await runGrader(grader, index, {
          runId,
          workspace: environment.workspace,
          artifactStore: this.artifactStore,
          store: this.store,
        });
        grades.push(grade);
        this.store.recordGrade(runId, grade);
        artifactRefs.push(...grade.artifactRefs);
        await runnerTrace.emit('verification.finished', {
          graderIndex: index,
          type: grader.type,
          passed: grade.passed,
          score: grade.score,
          durationMs: grade.durationMs,
        }, { artifactRefs: grade.artifactRefs });
      }

      const totalWeight = grades.reduce((sum, grade) => sum + grade.weight, 0);
      const score = totalWeight === 0
        ? 0
        : grades.reduce((sum, grade) => sum + grade.score * grade.weight, 0) / totalWeight;
      const passed = agent.status === 'completed' &&
        grades.filter((grade) => grade.required).every((grade) => grade.passed);
      const status = abortReason === 'timeout'
        ? 'timed_out'
        : abortReason
          ? 'budget_exceeded'
          : passed
            ? 'passed'
            : agent.status === 'failed'
              ? 'error'
              : 'failed';
      this.store.completeRun(runId, {
        status,
        finalText: agent.finalText,
        ...(agent.sessionKey ? { sessionKey: agent.sessionKey } : {}),
        ...(agent.agentRunId ? { agentRunId: agent.agentRunId } : {}),
        ...(agent.usage ? { usage: agent.usage } : {}),
        ...(agent.runtimeIdentity ? { runtimeIdentity: agent.runtimeIdentity } : {}),
        ...(agent.error ? { error: agent.error } : {}),
        score,
      });
      await runnerTrace.emit('run.completed', { status, score, passed });
      return { runId, status, agent, grades, score, artifactRefs };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = abortReason === 'timeout'
        ? 'timed_out'
        : abortReason
          ? 'budget_exceeded'
          : 'error';
      const totalWeight = grades.reduce((sum, grade) => sum + grade.weight, 0);
      const score = totalWeight === 0
        ? 0
        : grades.reduce((sum, grade) => sum + grade.score * grade.weight, 0) / totalWeight;
      this.store.completeRun(runId, {
        status,
        finalText: agent.finalText,
        error: message,
        score,
      });
      await runnerTrace.emit('run.failed', { error: message, abortReason }).catch(() => {});
      return {
        runId,
        status,
        agent: { ...agent, status: 'failed', error: message },
        grades,
        score,
        artifactRefs,
      };
    } finally {
      await adapter.cleanup?.(runId).catch(() => {});
      if (!this.keepWorkspaces) this.sandbox.cleanup(environment);
    }
  }
}
