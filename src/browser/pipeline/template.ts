/**
 * Pipeline template expression engine.
 *
 * Supports: ${{ args.xxx }}, ${{ data }}, ${{ data | json }}, ${{ error.message }}
 * Does NOT execute arbitrary JavaScript — only whitelisted expressions.
 */

const TEMPLATE_RE = /\$\{\{\s*(.+?)\s*\}\}/g;

export interface TemplateContext {
  args: Record<string, unknown>;
  data: unknown;
  error?: { code?: string; message?: string };
}

function resolvePath(obj: unknown, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current === 'object') {
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
    default:
      return String(value ?? '');
  }
}

function evaluateExpression(expr: string, ctx: TemplateContext): string {
  // Check for pipe filter: `data | json`
  const pipeIdx = expr.indexOf('|');
  let path = expr;
  let filter: string | undefined;
  if (pipeIdx > 0) {
    path = expr.slice(0, pipeIdx).trim();
    filter = expr.slice(pipeIdx + 1).trim();
  }

  let value: unknown;

  if (path === 'data') {
    value = ctx.data;
  } else if (path.startsWith('args.')) {
    value = resolvePath(ctx.args, path.slice(5));
  } else if (path.startsWith('error.')) {
    value = resolvePath(ctx.error, path.slice(6));
  } else if (path === 'error') {
    value = ctx.error?.message ?? '';
  } else {
    // Try resolving from args as fallback
    value = resolvePath(ctx.args, path) ?? `\${{ ${expr} }}`;
  }

  if (filter) {
    return applyFilter(value, filter);
  }

  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

/**
 * Resolve all `${{ ... }}` expressions in a string.
 */
export function resolveTemplate(template: string, ctx: TemplateContext): string {
  return template.replace(TEMPLATE_RE, (_match, expr: string) => {
    return evaluateExpression(expr.trim(), ctx);
  });
}

/**
 * Deep-resolve templates in an object/array/string value.
 */
export function resolveTemplateDeep(value: unknown, ctx: TemplateContext): unknown {
  if (typeof value === 'string') {
    return resolveTemplate(value, ctx);
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
