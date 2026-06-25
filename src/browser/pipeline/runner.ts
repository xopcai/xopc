/**
 * Pipeline runner: deterministic browser automation DSL execution.
 */

import { setTimeout as sleep } from 'node:timers/promises';

import { createLogger } from '../../utils/logger.js';
import type { BrowserActionContext, BrowserActionRegistry, BrowserActionResult } from '../actions/types.js';
import { loadBrowserPipelineSource, resolvePipelineIncludeLocation } from './source.js';
import { parseBrowserPipeline, type PipelineDocument, type PipelineStep } from './schema.js';
import { isTruthyValue, resolveTemplateDeep, type TemplateContext } from './template.js';
import { addStepTrace, createPipelineOutput, formatPipelineResult, type PipelineOutput } from './output.js';

const log = createLogger('PipelineRunner');

const CONTROL_ACTIONS = new Set(['if', 'retry', 'sleep', 'set_var']);

export interface ValidateResult {
  ok: boolean;
  document?: PipelineDocument;
  errors: { path: string; message: string }[];
}

export interface RunBrowserPipelineOptions {
  dryRun?: boolean;
  sourceLocation?: string;
}

interface PipelineRuntime {
  doc: PipelineDocument;
  args: Record<string, unknown>;
  last: unknown;
  outputs: unknown[];
  vars: Record<string, unknown>;
  error?: { code?: string; message?: string };
}

export function validateBrowserPipeline(yamlSource: string, registry?: BrowserActionRegistry): ValidateResult {
  const parseResult = parseBrowserPipeline(yamlSource);
  if (!parseResult.ok || !parseResult.document) {
    return { ok: false, errors: parseResult.errors };
  }

  const errors: { path: string; message: string }[] = [];
  validateSteps(parseResult.document.pipeline, 'pipeline', registry, errors);
  validateSteps(parseResult.document.onError ?? [], 'on_error', registry, errors);
  return errors.length > 0
    ? { ok: false, document: parseResult.document, errors }
    : { ok: true, document: parseResult.document, errors: [] };
}

export async function validateBrowserPipelineSource(
  yamlSource: string,
  registry?: BrowserActionRegistry,
  sourceLocation?: string,
): Promise<ValidateResult> {
  try {
    const doc = await expandPipelineDocument(yamlSource, sourceLocation);
    const errors: { path: string; message: string }[] = [];
    validateSteps(doc.pipeline, 'pipeline', registry, errors);
    validateSteps(doc.onError ?? [], 'on_error', registry, errors);
    return errors.length > 0 ? { ok: false, document: doc, errors } : { ok: true, document: doc, errors: [] };
  } catch (e) {
    return { ok: false, errors: [{ path: '', message: e instanceof Error ? e.message : String(e) }] };
  }
}

function validateSteps(
  steps: PipelineStep[],
  path: string,
  registry: BrowserActionRegistry | undefined,
  errors: { path: string; message: string }[],
): void {
  if (!registry) return;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (!CONTROL_ACTIONS.has(step.action) && !registry.has(step.action)) {
      errors.push({ path: `${path}[${i}]`, message: `Unknown action: "${step.action}"` });
    }
  }
}

async function expandPipelineDocument(
  yamlSource: string,
  sourceLocation: string | undefined,
  visiting = new Set<string>(),
): Promise<PipelineDocument> {
  const parsed = parseBrowserPipeline(yamlSource);
  if (!parsed.ok || !parsed.document) {
    const message = parsed.errors.map((e) => `${e.path}: ${e.message}`).join('\n');
    throw new Error(message);
  }

  const doc = parsed.document;
  const key = sourceLocation ?? `inline:${doc.name}`;
  if (visiting.has(key)) {
    throw new Error(`Circular pipeline include detected: ${key}`);
  }

  visiting.add(key);
  let merged: PipelineDocument = {
    name: doc.name,
    description: doc.description,
    provider: doc.provider,
    include: [],
    timeoutSeconds: doc.timeoutSeconds,
    args: {},
    pipeline: [],
    onError: [],
  };

  for (const includePath of doc.include ?? []) {
    const includeLocation = resolvePipelineIncludeLocation(includePath, sourceLocation);
    const includeSource = await loadBrowserPipelineSource(includeLocation);
    const includeDoc = await expandPipelineDocument(includeSource.source, includeSource.location, visiting);
    merged = mergePipelineDocuments(merged, includeDoc);
  }

  merged = mergePipelineDocuments(merged, doc);
  visiting.delete(key);
  return merged;
}

function mergePipelineDocuments(target: PipelineDocument, source: PipelineDocument): PipelineDocument {
  return {
    name: source.name || target.name,
    description: source.description ?? target.description,
    provider: source.provider ?? target.provider,
    include: [...(target.include ?? []), ...(source.include ?? [])],
    timeoutSeconds: source.timeoutSeconds ?? target.timeoutSeconds,
    args: { ...target.args, ...source.args },
    pipeline: [...target.pipeline, ...source.pipeline],
    onError: [...(target.onError ?? []), ...(source.onError ?? [])],
  };
}

function resolveArgs(doc: PipelineDocument, overrides: Record<string, unknown>): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const key of Object.keys(overrides)) {
    if (!(key in doc.args)) {
      throw new Error(`Unknown pipeline arg: ${key}`);
    }
  }
  for (const [key, def] of Object.entries(doc.args)) {
    const value = key in overrides ? overrides[key] : def.default;
    if (value === undefined) {
      if (def.required) throw new Error(`Missing required arg: ${key}`);
      continue;
    }
    if (def.choices && !def.choices.some((choice) => Object.is(choice, value))) {
      throw new Error(`Invalid value for arg ${key}: expected one of ${def.choices.map(String).join(', ')}`);
    }
    resolved[key] = value;
  }
  return resolved;
}

function templateContext(runtime: PipelineRuntime): TemplateContext {
  return {
    args: runtime.args,
    last: runtime.last,
    outputs: runtime.outputs,
    vars: runtime.vars,
    error: runtime.error,
  };
}

function actionArgs(step: PipelineStep, runtime: PipelineRuntime): Record<string, unknown> {
  if (typeof step.args === 'string') {
    const resolved = resolveTemplateDeep(step.args, templateContext(runtime));
    if (step.action === 'evaluate' || step.action === 'eval' || step.action === 'console') {
      return { javascript: String(resolved ?? '') };
    }
    return { value: resolved };
  }
  return resolveTemplateDeep(step.args, templateContext(runtime)) as Record<string, unknown>;
}

async function executePipeline(
  steps: PipelineStep[],
  scope: string,
  runtime: PipelineRuntime,
  actionCtx: BrowserActionContext,
  registry: BrowserActionRegistry,
  output: PipelineOutput,
): Promise<void> {
  for (let i = 0; i < steps.length; i++) {
    if (actionCtx.signal?.aborted) {
      throw actionError('ABORTED', 'Pipeline aborted');
    }
    await executeStep(steps[i], i, scope, runtime, actionCtx, registry, output);
  }
}

async function executeStep(
  step: PipelineStep,
  index: number,
  scope: string,
  runtime: PipelineRuntime,
  actionCtx: BrowserActionContext,
  registry: BrowserActionRegistry,
  output: PipelineOutput,
): Promise<void> {
  const started = Date.now();
  let result: BrowserActionResult;
  try {
    result = await executeStepOnce(step, index, scope, runtime, actionCtx, registry, output);
  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e));
    result = {
      ok: false,
      action: step.action,
      error: { code: (error as Error & { code?: string }).code ?? 'STEP_FAILED', message: error.message },
    };
  }

  addStepTrace(output, {
    index,
    scope,
    action: step.action,
    ok: result.ok,
    elapsedMs: Date.now() - started,
    text: result.text?.slice(0, 500),
    data: result.data,
    error: result.error,
  }, result);

  if (!result.ok) {
    runtime.error = result.error;
    throw actionError(result.error?.code ?? 'STEP_FAILED', result.error?.message ?? 'Step failed');
  }
}

async function executeStepOnce(
  step: PipelineStep,
  index: number,
  scope: string,
  runtime: PipelineRuntime,
  actionCtx: BrowserActionContext,
  registry: BrowserActionRegistry,
  output: PipelineOutput,
): Promise<BrowserActionResult> {
  switch (step.action) {
    case 'sleep': {
      const args = actionArgs(step, runtime);
      const ms = Number(args.ms ?? args.delay_ms ?? args.delayMs ?? 1000);
      await sleep(Number.isFinite(ms) ? ms : 1000, undefined, { signal: actionCtx.signal });
      runtime.last = null;
      return { ok: true, action: 'sleep', text: `Slept ${ms}ms.`, data: null };
    }
    case 'set_var': {
      const args = actionArgs(step, runtime);
      const name = String(args.name ?? '');
      if (!name) return { ok: false, action: 'set_var', error: { code: 'INVALID_ARGS', message: 'name is required' } };
      runtime.vars[name] = args.value;
      runtime.last = args.value;
      return { ok: true, action: 'set_var', text: `Set var: ${name}`, data: args.value };
    }
    case 'if': {
      const args = actionArgs(step, runtime);
      const branch = isTruthyValue(args.condition) ? args.then : args.else;
      const branchSteps = normalizeNestedPipeline(branch, `${scope}.${index}.if`);
      await executePipeline(branchSteps, `${scope}.${index}.if`, runtime, actionCtx, registry, output);
      return { ok: true, action: 'if', text: 'Conditional branch completed.', data: runtime.last };
    }
    case 'retry': {
      const args = actionArgs(step, runtime);
      const times = Math.max(1, Number(args.times ?? 3));
      const delayMs = Math.max(0, Number(args.delay_ms ?? args.delayMs ?? 250));
      const retrySteps = normalizeNestedPipeline(args.pipeline ?? args.step, `${scope}.${index}.retry`);
      let lastError: unknown;
      for (let attempt = 1; attempt <= times; attempt++) {
        try {
          await executePipeline(retrySteps, `${scope}.${index}.retry.${attempt}`, runtime, actionCtx, registry, output);
          output.ok = true;
          output.error = undefined;
          return { ok: true, action: 'retry', text: `Retry block completed on attempt ${attempt}.`, data: runtime.last };
        } catch (e) {
          lastError = e;
          output.ok = true;
          output.error = undefined;
          if (attempt < times) await sleep(delayMs, undefined, { signal: actionCtx.signal });
        }
      }
      const message = lastError instanceof Error ? lastError.message : String(lastError);
      return { ok: false, action: 'retry', error: { code: 'RETRY_FAILED', message } };
    }
    default:
      return executeBrowserAction(step, runtime, actionCtx, registry);
  }
}

async function executeBrowserAction(
  step: PipelineStep,
  runtime: PipelineRuntime,
  actionCtx: BrowserActionContext,
  registry: BrowserActionRegistry,
): Promise<BrowserActionResult> {
  const args = actionArgs(step, runtime);
  actionCtx.pipeline = {
    args: runtime.args,
    last: runtime.last,
    outputs: runtime.outputs,
    vars: runtime.vars,
    error: runtime.error,
  };
  const result = await registry.execute(step.action, actionCtx, args);
  if (result.ok) {
    if (step.action === 'output') {
      runtime.outputs.push(result.data);
    }
    if (result.data !== undefined) {
      runtime.last = result.data;
    }
  }
  return result;
}

function normalizeNestedPipeline(value: unknown, path: string): PipelineStep[] {
  const rawSteps = Array.isArray(value) ? value : value ? [value] : [];
  return rawSteps.map((rawStep, index) => {
    if (!rawStep || typeof rawStep !== 'object' || Array.isArray(rawStep)) {
      throw new Error(`${path}[${index}] must be a YAML object`);
    }
    const obj = rawStep as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.length !== 1) {
      throw new Error(`${path}[${index}] must contain exactly one action`);
    }
    const action = keys[0];
    const args = obj[action];
    if (typeof args === 'string') return { action, args };
    if (args && typeof args === 'object' && !Array.isArray(args)) return { action, args: args as Record<string, unknown> };
    if (args === undefined || args === null) return { action, args: {} };
    return { action, args: { value: args } };
  });
}

function actionError(code: string, message: string): Error {
  const error = new Error(message) as Error & { code?: string };
  error.code = code;
  return error;
}

export async function runBrowserPipeline(
  yamlSource: string,
  argOverrides: Record<string, unknown>,
  ctx: BrowserActionContext,
  registry: BrowserActionRegistry,
  options: RunBrowserPipelineOptions = {},
): Promise<BrowserActionResult> {
  let doc: PipelineDocument;
  try {
    doc = await expandPipelineDocument(yamlSource, options.sourceLocation);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, action: 'pipeline', error: { code: 'VALIDATION_FAILED', message: msg }, text: msg };
  }

  const validationErrors: { path: string; message: string }[] = [];
  validateSteps(doc.pipeline, 'pipeline', registry, validationErrors);
  validateSteps(doc.onError ?? [], 'on_error', registry, validationErrors);
  if (validationErrors.length > 0) {
    const msg = validationErrors.map((e) => `${e.path}: ${e.message}`).join('\n');
    return { ok: false, action: 'pipeline', error: { code: 'VALIDATION_FAILED', message: msg }, text: msg };
  }

  if (options.dryRun) {
    return {
      ok: true,
      action: 'pipeline',
      text: `Pipeline "${doc.name}" validated successfully (${doc.pipeline.length} steps).`,
      data: { name: doc.name, steps: doc.pipeline.length, args: Object.keys(doc.args) },
    };
  }

  let args: Record<string, unknown>;
  try {
    args = resolveArgs(doc, argOverrides);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, action: 'pipeline', error: { code: 'ARG_RESOLUTION_FAILED', message: msg }, text: msg };
  }

  const output = createPipelineOutput(doc.name);
  const runtime: PipelineRuntime = { doc, args, last: undefined, outputs: [], vars: {} };

  log.info({ pipeline: doc.name, steps: doc.pipeline.length }, `Running pipeline: ${doc.name}`);

  try {
    const run = executePipeline(doc.pipeline, 'pipeline', runtime, ctx, registry, output);
    if (doc.timeoutSeconds && doc.timeoutSeconds > 0) {
      await Promise.race([
        run,
        sleep(doc.timeoutSeconds * 1000, undefined, { signal: ctx.signal }).then(() => {
          throw actionError('PIPELINE_TIMEOUT', `Pipeline timed out after ${doc.timeoutSeconds} seconds`);
        }),
      ]);
    } else {
      await run;
    }
  } catch {
    output.ok = false;
    output.error ??= { step: output.trace.length, action: 'pipeline', code: 'PIPELINE_FAILED', message: runtime.error?.message ?? 'Pipeline failed' };
  }

  output.last = runtime.last;
  output.outputs = runtime.outputs;

  if (!output.ok && doc.onError && doc.onError.length > 0) {
    log.info({ pipeline: doc.name }, 'Running on_error diagnostics');
    try {
      await executePipeline(doc.onError, 'on_error', runtime, ctx, registry, output);
    } catch {
      // Main pipeline error remains authoritative.
    }
    output.last = runtime.last;
    output.outputs = runtime.outputs;
  }

  return formatPipelineResult(output);
}
