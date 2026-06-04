/**
 * Static lint for workflow scripts.
 *
 * Catches the single most common AI-authoring bug: calling `agent()`,
 * `parallel()`, or `pipeline()` without `await` and then using the returned
 * Promise as if it were a value. The runtime would throw a cryptic TypeError
 * like `results.map is not a function`; this lint converts it into an
 * actionable error before the script ever runs.
 *
 * Rules (per matching CallExpression):
 *   Allowed parents
 *     - AwaitExpression argument                  `await parallel(...)`
 *     - ReturnStatement argument                  `return agent(...)` (auto-unwraps)
 *     - ExpressionStatement                       fire-and-forget; pending agents drain
 *     - ArrowFunctionExpression expression body   `() => agent(...)` (thunk for parallel/pipeline)
 *   Anything else (VariableDeclarator init, MemberExpression object, template
 *   interpolation, binary/logical operand, call argument, property/array
 *   element, ...) is rejected with a teaching message.
 *
 * Out of scope (handled by the runtime):
 *   - `parallel([agent(...), agent(...)])` (promises instead of thunks) — caught
 *     by the runtime's TypeError ("expects an array of functions, not promises").
 *   - Promise-as-value bugs that survive lint (dynamic indirection, late await).
 */

import type { Node } from 'acorn';

type AnyNode = Node & {
  [key: string]: any;
  start: number;
  end: number;
  loc?: { start: { line: number; column: number } };
};

const LINT_TARGETS = new Set(['agent', 'parallel', 'pipeline']);

export function lintAwaits(ast: AnyNode): void {
  walk(ast, null, (node, parent) => {
    if (!isLintTarget(node)) return;
    if (isAcceptableParent(parent, node)) return;
    const calleeName = (node.callee as AnyNode).name as string;
    const line = node.loc?.start.line ?? '?';
    throw new Error(formatError(calleeName, line, parent));
  });
}

function isLintTarget(node: AnyNode): boolean {
  if (node.type !== 'CallExpression') return false;
  const callee = node.callee as AnyNode | undefined;
  if (!callee || callee.type !== 'Identifier') return false;
  return LINT_TARGETS.has(callee.name);
}

function isAcceptableParent(parent: AnyNode | null, call: AnyNode): boolean {
  if (!parent) return false;
  switch (parent.type) {
    case 'AwaitExpression':
      return parent.argument === call;
    case 'ReturnStatement':
      return parent.argument === call;
    case 'ExpressionStatement':
      return parent.expression === call;
    case 'ArrowFunctionExpression':
      // `() => agent(...)` — thunk-style body that the runtime invokes/awaits.
      return parent.expression === true && parent.body === call;
    default:
      return false;
  }
}

function formatError(name: string, line: number | string, parent: AnyNode | null): string {
  const ctx = parentContextHint(parent);
  return [
    `workflow lint error at line ${line}: \`${name}(...)\` returns a Promise but is used without 'await'${ctx ? ` (${ctx})` : ''}.`,
    `  ❌ const x = ${name}(...); x.map(...)`,
    `  ✅ const x = await ${name}(...); x.map(...)`,
    `Workflow scripts run in an async IIFE — 'await' parallel()/pipeline()/agent() before using their results, or 'return' them directly.`,
  ].join('\n');
}

function parentContextHint(parent: AnyNode | null): string {
  if (!parent) return '';
  switch (parent.type) {
    case 'VariableDeclarator':
      return 'assigned to variable';
    case 'AssignmentExpression':
      return 'assigned via =';
    case 'MemberExpression':
      return 'method/property access on Promise';
    case 'TemplateLiteral':
      return 'interpolated in template string';
    case 'BinaryExpression':
    case 'LogicalExpression':
      return 'used in expression';
    case 'ConditionalExpression':
      return 'used as ternary operand';
    case 'CallExpression':
      return 'passed as argument';
    case 'Property':
      return 'used as object property value';
    case 'ArrayExpression':
      return 'placed in array (use a thunk: () => ' + 'call)';
    case 'SpreadElement':
      return 'spread';
    case 'IfStatement':
    case 'WhileStatement':
    case 'DoWhileStatement':
    case 'ForStatement':
      return 'used as condition';
    default:
      return parent.type;
  }
}

function walk(
  node: AnyNode,
  parent: AnyNode | null,
  visit: (n: AnyNode, p: AnyNode | null) => void,
): void {
  visit(node, parent);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const v of value) {
        if (isAstNode(v)) walk(v, node, visit);
      }
    } else if (isAstNode(value)) {
      walk(value, node, visit);
    }
  }
}

function isAstNode(value: unknown): value is AnyNode {
  return !!value && typeof value === 'object' && typeof (value as AnyNode).type === 'string';
}
