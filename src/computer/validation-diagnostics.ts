import { z } from 'zod';
import { ComputerValidationSchema } from './errors.js';

type Validation = z.infer<typeof ComputerValidationSchema>;
const Field = ComputerValidationSchema.shape.issues.element.shape.path.element;
const Action = ComputerValidationSchema.shape.action;
const Code = ComputerValidationSchema.shape.issues.element.shape.code;

function actionName(value: unknown): Validation['action'] {
  if (!value || typeof value !== 'object') return 'unknown';
  const node = value as Record<string, unknown>;
  return Action.safeParse(typeof node.action === 'string' ? node.action : node.kind).data ?? 'unknown';
}

/** Project only allowlisted metadata; Zod messages, values and arbitrary property names may contain private data. */
export function modelValidation(value: unknown, stage: Validation['stage'], error?: unknown,
  failure?: { path: (string | number)[]; code: Validation['issues'][number]['code'] }): Validation {
  const root = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const payload = root.arguments && typeof root.arguments === 'object' ? root.arguments as Record<string, unknown> : root;
  const proposal = payload.proposal && typeof payload.proposal === 'object' ? payload.proposal as Record<string, unknown> : payload;
  const action = actionName(typeof proposal.action === 'object' ? proposal.action : proposal);
  const issues: Validation['issues'] = [];
  const append = (path: PropertyKey[], code: string) => {
    if (issues.length >= 4) return;
    let node: unknown = value;
    let nestedAction = action;
    for (const part of path) {
      if (!node || typeof node !== 'object') break;
      node = (node as Record<PropertyKey, unknown>)[part];
      const candidate = actionName(node);
      if (candidate !== 'unknown') nestedAction = candidate;
    }
    issues.push({ path: path.slice(0, 10).map(part => Field.safeParse(part).data ?? 'unknown_field'),
      code: Code.safeParse(code).data ?? 'invalid_value', action: nestedAction });
  };
  const branchScore = (list: readonly z.core.$ZodIssue[]) => list.length + list.filter(issue =>
    issue.code === 'invalid_value' && ['kind', 'action'].includes(String(issue.path.at(-1)))).length * 100;
  const visit = (list: readonly z.core.$ZodIssue[], prefix: PropertyKey[] = []) => {
    for (const issue of list) {
      if (issue.code === 'invalid_union' && issue.errors.length) {
        // Prefer the closest union branch; never retain its raw error object.
        visit([...issue.errors].sort((a, b) => branchScore(a) - branchScore(b))[0], [...prefix, ...issue.path]);
      } else if (issue.code === 'unrecognized_keys') {
        for (const key of issue.keys) append([...prefix, ...issue.path, key], issue.code);
      } else append([...prefix, ...issue.path], issue.code);
    }
  };
  if (error instanceof z.ZodError) visit(error.issues);
  if (failure) append(failure.path, failure.code);
  return { action, stage, issues };
}
