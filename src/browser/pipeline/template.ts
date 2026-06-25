/**
 * Pipeline template expression engine.
 *
 * Supports: ${{ args.xxx }}, ${{ last }}, ${{ outputs.0 }}, ${{ vars.name }},
 * ${{ error.message }} and simple pipe filters.
 * Does NOT execute arbitrary JavaScript — only whitelisted expressions.
 */

const TEMPLATE_RE = /\$\{\{\s*(.+?)\s*\}\}/g;

export interface TemplateContext {
  args: Record<string, unknown>;
  last: unknown;
  outputs: unknown[];
  vars: Record<string, unknown>;
  error?: { code?: string; message?: string };
}

function parsePath(path: string): string[] {
  return path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean);
}

export function resolvePath(obj: unknown, path: string): unknown {
  const parts = parsePath(path);
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      const index = Number(part);
      if (!Number.isInteger(index)) return undefined;
      current = current[index];
    } else if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return current;
}

function applyFilter(value: unknown, filter: string): string {
  switch (filter.trim()) {
    case 'json':
      return JSON.stringify(value, null, 2) ?? 'null';
    case 'string':
      return String(value ?? '');
    case 'number':
      return String(Number(value));
    case 'boolean':
      return String(Boolean(value));
    case 'urlencode':
      return encodeURIComponent(String(value ?? ''));
    default:
      return String(value ?? '');
  }
}

export function isTruthyValue(value: unknown): boolean {
  if (value === null || value === undefined || value === false) return false;
  if (typeof value === 'number') return Number.isFinite(value) && value !== 0;
  if (typeof value === 'string') return value.length > 0 && value !== 'false' && value !== '0';
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

export function valueContains(actual: unknown, expected: unknown): boolean {
  if (typeof actual === 'string') return actual.includes(String(expected));
  if (Array.isArray(actual)) return actual.some((item) => JSON.stringify(item) === JSON.stringify(expected));
  if (actual && typeof actual === 'object') return JSON.stringify(actual).includes(String(expected));
  return String(actual ?? '').includes(String(expected));
}

export function evaluateRawExpression(expr: string, ctx: TemplateContext): unknown {
  // Check for pipe filter: `last | json`
  const pipeIdx = expr.indexOf('|');
  let path = expr;
  let filter: string | undefined;
  if (pipeIdx > 0) {
    path = expr.slice(0, pipeIdx).trim();
    filter = expr.slice(pipeIdx + 1).trim();
  }

  let value: unknown;

  if (path === 'last') {
    value = ctx.last;
  } else if (path.startsWith('last.')) {
    value = resolvePath(ctx.last, path.slice(5));
  } else if (path.startsWith('args.')) {
    value = resolvePath(ctx.args, path.slice(5));
  } else if (path === 'outputs') {
    value = ctx.outputs;
  } else if (path.startsWith('outputs.')) {
    value = resolvePath(ctx.outputs, path.slice(8));
  } else if (path === 'vars') {
    value = ctx.vars;
  } else if (path.startsWith('vars.')) {
    value = resolvePath(ctx.vars, path.slice(5));
  } else if (path.startsWith('error.')) {
    value = resolvePath(ctx.error, path.slice(6));
  } else if (path === 'error') {
    value = ctx.error?.message ?? '';
  } else {
    value = resolvePath(ctx.args, path);
    if (value === undefined) return `\${{ ${expr} }}`;
  }

  if (filter) {
    return applyFilter(value, filter);
  }

  return value;
}

function stringifyTemplateValue(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function evaluateExpression(expr: string, ctx: TemplateContext): string {
  return stringifyTemplateValue(evaluateRawExpression(expr, ctx));
}

/**
 * Resolve all `${{ ... }}` expressions in a string.
 */
export function resolveTemplate(template: string, ctx: TemplateContext): string {
  return template.replace(TEMPLATE_RE, (_match, expr: string) => {
    return evaluateExpression(expr.trim(), ctx);
  });
}

export function resolveTemplateValue(value: string, ctx: TemplateContext): unknown {
  const trimmed = value.trim();
  const match = /^\$\{\{\s*(.+?)\s*\}\}$/.exec(trimmed);
  if (!match) return resolveTemplate(value, ctx);
  return evaluateRawExpression(match[1].trim(), ctx);
}

/**
 * Deep-resolve templates in an object/array/string value.
 */
export function resolveTemplateDeep(value: unknown, ctx: TemplateContext): unknown {
  if (typeof value === 'string') {
    return resolveTemplateValue(value, ctx);
  }
  if (Array.isArray(value)) {
    return value.map((item) => resolveTemplateDeep(item, ctx));
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      result[resolveTemplate(k, ctx)] = resolveTemplateDeep(v, ctx);
    }
    return result;
  }
  return value;
}
