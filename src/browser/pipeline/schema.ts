/**
 * Pipeline YAML schema — parse and validate brocli-style browser pipeline documents.
 */

import yaml from 'js-yaml';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PipelineArgDef {
  type: string;
  required?: boolean;
  default?: unknown;
  description?: string;
  choices?: unknown[];
}

export interface PipelineStep {
  /** The single action name (key of the step object). */
  action: string;
  /** Action arguments (value of that key), or raw string for shorthand like `evaluate: |`. */
  args: Record<string, unknown> | string;
}

export interface PipelineDocument {
  name: string;
  description?: string;
  provider?: string;
  include?: string[];
  args: Record<string, PipelineArgDef>;
  pipeline: PipelineStep[];
  onError?: PipelineStep[];
}

export interface PipelineValidationError {
  path: string;
  message: string;
}

export interface PipelineParseResult {
  ok: boolean;
  document?: PipelineDocument;
  errors: PipelineValidationError[];
}

// ─── Parse ──────────────────────────────────────────────────────────────────

export function parseBrowserPipeline(yamlSource: string): PipelineParseResult {
  const errors: PipelineValidationError[] = [];

  let raw: unknown;
  try {
    raw = yaml.load(yamlSource);
  } catch (e) {
    return { ok: false, errors: [{ path: '', message: `YAML parse error: ${e instanceof Error ? e.message : String(e)}` }] };
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: [{ path: '', message: 'Pipeline must be a YAML mapping (object).' }] };
  }

  const doc = raw as Record<string, unknown>;

  // name
  const name = typeof doc.name === 'string' ? doc.name.trim() : '';
  if (!name) errors.push({ path: 'name', message: '`name` is required.' });

  // description
  const description = typeof doc.description === 'string' ? doc.description : undefined;

  // provider
  const provider = typeof doc.provider === 'string' ? doc.provider : undefined;

  // include
  const include = Array.isArray(doc.include)
    ? doc.include.filter((x): x is string => typeof x === 'string')
    : undefined;

  // args
  const argsRaw = (doc.args && typeof doc.args === 'object' && !Array.isArray(doc.args)) ? doc.args as Record<string, unknown> : {};
  const args: Record<string, PipelineArgDef> = {};
  for (const [k, v] of Object.entries(argsRaw)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const def = v as Record<string, unknown>;
      args[k] = {
        type: typeof def.type === 'string' ? def.type : 'string',
        required: def.required === true,
        default: def.default,
        description: typeof def.description === 'string' ? def.description : undefined,
        choices: Array.isArray(def.choices) ? def.choices : undefined,
      };
    } else {
      args[k] = { type: 'string', default: v };
    }
  }

  // pipeline
  const pipelineRaw = doc.pipeline;
  if (!Array.isArray(pipelineRaw)) {
    errors.push({ path: 'pipeline', message: '`pipeline` must be an array of steps.' });
    return { ok: false, errors };
  }

  const pipeline: PipelineStep[] = [];
  for (let i = 0; i < pipelineRaw.length; i++) {
    const step = pipelineRaw[i];
    if (!step || typeof step !== 'object' || Array.isArray(step)) {
      errors.push({ path: `pipeline[${i}]`, message: 'Each step must be a YAML mapping.' });
      continue;
    }
    const stepObj = step as Record<string, unknown>;
    const actionKeys = Object.keys(stepObj);
    if (actionKeys.length !== 1) {
      errors.push({ path: `pipeline[${i}]`, message: `Each step must have exactly one action key, found ${actionKeys.length}: [${actionKeys.join(', ')}].` });
      continue;
    }
    const action = actionKeys[0];
    const actionArgs = stepObj[action];
    if (typeof actionArgs === 'string') {
      pipeline.push({ action, args: actionArgs });
    } else if (actionArgs && typeof actionArgs === 'object' && !Array.isArray(actionArgs)) {
      pipeline.push({ action, args: actionArgs as Record<string, unknown> });
    } else if (actionArgs === null || actionArgs === undefined) {
      pipeline.push({ action, args: {} });
    } else {
      pipeline.push({ action, args: { value: actionArgs } });
    }
  }

  // on_error
  const onErrorRaw = doc.on_error;
  let onError: PipelineStep[] | undefined;
  if (Array.isArray(onErrorRaw)) {
    onError = [];
    for (let i = 0; i < onErrorRaw.length; i++) {
      const step = onErrorRaw[i];
      if (!step || typeof step !== 'object' || Array.isArray(step)) continue;
      const stepObj = step as Record<string, unknown>;
      const actionKeys = Object.keys(stepObj);
      if (actionKeys.length !== 1) continue;
      const action = actionKeys[0];
      const actionArgs = stepObj[action];
      if (typeof actionArgs === 'string') {
        onError.push({ action, args: actionArgs });
      } else if (actionArgs && typeof actionArgs === 'object' && !Array.isArray(actionArgs)) {
        onError.push({ action, args: actionArgs as Record<string, unknown> });
      } else {
        onError.push({ action, args: {} });
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    document: { name, description, provider, include, args, pipeline, onError },
    errors: [],
  };
}
