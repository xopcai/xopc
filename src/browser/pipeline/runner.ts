/**
 * Pipeline runner — validate and execute brocli-style YAML browser pipelines.
 */

import { createLogger } from '../../utils/logger.js';
import type { BrowserActionContext, BrowserActionRegistry, BrowserActionResult } from '../actions/types.js';
import { parseBrowserPipeline, type PipelineDocument, type PipelineStep } from './schema.js';
import { resolveTemplateDeep, type TemplateContext } from './template.js';
import { addStepResult, createPipelineOutput, formatPipelineResult } from './output.js';

const log = createLogger('PipelineRunner');

// ─── Validate ───────────────────────────────────────────────────────────────

export interface ValidateResult {
  ok: boolean;
  document?: PipelineDocument;
  errors: { path: string; message: string }[];
}

/**
 * Parse and validate a pipeline YAML without executing it.
 */
export function validateBrowserPipeline(yamlSource: string, registry?: BrowserActionRegistry): ValidateResult {
  const parseResult = parseBrowserPipeline(yamlSource);
  if (!parseResult.ok || !parseResult.document) {
    return { ok: false, errors: parseResult.errors };
  }

  const doc = parseResult.document;
  const errors: { path: string; message: string }[] = [];

  // Validate actions exist in registry
  if (registry) {
    for (let i = 0; i < doc.pipeline.length; i++) {
      const step = doc.pipeline[i];
      if (!registry.has(step.action)) {
        errors.push({ path: `pipeline[${i}]`, message: `Unknown action: "${step.action}"` });
      }
    }
    if (doc.onError) {
      for (let i = 0; i < doc.onError.length; i++) {
        const step = doc.onError[i];
        if (!registry.has(step.action)) {
          errors.push({ path: `on_error[${i}]`, message: `Unknown action: "${step.action}"` });
        }
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, document: doc, errors };
  }

  return { ok: true, document: doc, errors: [] };
}

// ─── Resolve args ───────────────────────────────────────────────────────────

function resolveArgs(doc: PipelineDocument, overrides: Record<string, unknown>): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const [key, def] of Object.entries(doc.args)) {
    if (key in overrides) {
      resolved[key] = overrides[key];
    } else if (def.default !== undefined) {
      resolved[key] = def.default;
    } else if (def.required) {
      throw new Error(`Missing required arg: ${key}`);
    }
  }
  // Pass through any extra overrides not in schema
  for (const [key, val] of Object.entries(overrides)) {
    if (!(key in resolved)) resolved[key] = val;
  }
  return resolved;
}

// ─── Execute step ───────────────────────────────────────────────────────────

async function executeStep(
  step: PipelineStep,
  templateCtx: TemplateContext,
  actionCtx: BrowserActionContext,
  registry: BrowserActionRegistry,
): Promise<BrowserActionResult> {
  // Resolve templates in step args
  let resolvedArgs: Record<string, unknown>;
  if (typeof step.args === 'string') {
    // Shorthand: e.g. `evaluate: |` — the string IS the expression/code
    const resolved = resolveTemplateDeep(step.args, templateCtx) as string;
    // For evaluate/console, pass as `javascript`; for others, as `value`
    if (step.action === 'evaluate' || step.action === 'eval' || step.action === 'console') {
      resolvedArgs = { javascript: resolved };
    } else {
      resolvedArgs = { value: resolved };
    }
  } else {
    resolvedArgs = resolveTemplateDeep(step.args, templateCtx) as Record<string, unknown>;
  }

  return registry.execute(step.action, actionCtx, resolvedArgs);
}

// ─── Run ────────────────────────────────────────────────────────────────────

/**
 * Run a browser pipeline from YAML source.
 *
 * @param yamlSource - Raw YAML text.
 * @param argOverrides - Runtime argument overrides.
 * @param ctx - Browser action context (page, manager, config, etc.).
 * @param registry - Action registry.
 * @param dryRun - When true, only validate without executing.
 */
export async function runBrowserPipeline(
  yamlSource: string,
  argOverrides: Record<string, unknown>,
  ctx: BrowserActionContext,
  registry: BrowserActionRegistry,
  dryRun = false,
): Promise<BrowserActionResult> {
  // Parse & validate
  const validation = validateBrowserPipeline(yamlSource, registry);
  if (!validation.ok || !validation.document) {
    const errMsg = validation.errors.map((e) => `${e.path}: ${e.message}`).join('\n');
    return {
      ok: false,
      action: 'pipeline',
      error: { code: 'VALIDATION_FAILED', message: errMsg },
    };
  }

  const doc = validation.document;

  // Dry run: just return validation success
  if (dryRun) {
    return {
      ok: true,
      action: 'pipeline',
      text: `Pipeline "${doc.name}" validated successfully (${doc.pipeline.length} steps).`,
      data: { name: doc.name, steps: doc.pipeline.length, args: Object.keys(doc.args) },
    };
  }

  // Resolve args
  let resolvedArgs: Record<string, unknown>;
  try {
    resolvedArgs = resolveArgs(doc, argOverrides);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      action: 'pipeline',
      error: { code: 'ARG_RESOLUTION_FAILED', message: msg },
    };
  }

  const output = createPipelineOutput(doc.name);
  let data: unknown = undefined;

  const templateCtx: TemplateContext = {
    args: resolvedArgs,
    data: undefined,
  };

  // Inject pipeline data into action context
  ctx.pipelineData = undefined;

  log.info({ pipeline: doc.name, steps: doc.pipeline.length }, `Running pipeline: ${doc.name}`);

  // Execute main pipeline
  for (let i = 0; i < doc.pipeline.length; i++) {
    if (ctx.signal?.aborted) {
      output.ok = false;
      output.error = { step: i, action: 'abort', code: 'ABORTED', message: 'Pipeline aborted' };
      break;
    }

    const step = doc.pipeline[i];
    const result = await executeStep(step, templateCtx, ctx, registry);
    addStepResult(output, i, result);

    // Update data accumulator
    if (result.ok && result.data !== undefined) {
      data = result.data;
      templateCtx.data = data;
      ctx.pipelineData = data;
    }

    // If output action, capture as final data
    if (step.action === 'output' && result.ok && result.data !== undefined) {
      output.data = result.data;
    }

    // Stop on failure
    if (!result.ok) {
      templateCtx.error = result.error ? { code: result.error.code, message: result.error.message } : undefined;
      break;
    }
  }

  // If pipeline succeeded but no explicit output, use last data
  if (output.ok && output.data === undefined) {
    output.data = data;
  }

  // Run on_error if pipeline failed
  if (!output.ok && doc.onError && doc.onError.length > 0) {
    log.info({ pipeline: doc.name }, 'Running on_error diagnostics');
    for (const step of doc.onError) {
      if (ctx.signal?.aborted) break;
      try {
        const result = await executeStep(step, templateCtx, ctx, registry);
        // Collect artifacts from error handlers (screenshots, etc.)
        if (result.artifacts) output.artifacts.push(...result.artifacts);
      } catch {
        // on_error steps should not throw
      }
    }
  }

  return formatPipelineResult(output);
}
