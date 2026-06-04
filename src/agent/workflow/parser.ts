/**
 * Workflow script parser.
 *
 * Responsibilities:
 *   1. Parse the script with acorn (latest ECMA, top-level await + return allowed).
 *   2. Enforce determinism — reject `Date.now()`, `Math.random()`, `new Date()`,
 *      `require`, `import`, dynamic eval. This keeps future resume/replay possible
 *      and surfaces non-deterministic mistakes early.
 *   3. Require the first statement to be `export const meta = <literal>`, validate
 *      the literal shape, and strip that line from the body returned to the runtime.
 *
 * Returning a `{ meta, body }` pair means the runtime can `vm.Script(body)` without
 * any further AST work.
 */

import { parse } from 'acorn';
import type { Node } from 'acorn';

import { lintAwaits } from './lint.js';
import type { WorkflowMeta, WorkflowMetaPhase } from './types.js';

type AnyNode = Node & { [key: string]: any; start: number; end: number };

const NONDETERMINISM_ERROR =
  'Workflow scripts must be deterministic: Date.now()/Math.random()/new Date() are unavailable. ' +
  'Pass timestamps via args or stamp them after the workflow returns.';

export interface ParsedWorkflow {
  meta: WorkflowMeta;
  body: string;
}

export function parseWorkflowScript(script: string): ParsedWorkflow {
  let ast: AnyNode;
  try {
    ast = parse(script, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: true,
      ranges: false,
      locations: true,
    }) as AnyNode;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Workflow script parse error: ${msg}`);
  }

  assertDeterministicAst(ast);
  assertNoDangerousImports(ast);
  lintAwaits(ast);

  const first = ast.body?.[0] as AnyNode | undefined;
  if (first?.type !== 'ExportNamedDeclaration') {
    throw new Error(
      '`export const meta = { name, description }` must be the first statement in the script',
    );
  }

  const declaration = first.declaration as AnyNode | null;
  if (declaration?.type !== 'VariableDeclaration' || declaration.kind !== 'const') {
    throw new Error('meta export must be `export const meta = ...`');
  }
  if (declaration.declarations.length !== 1) {
    throw new Error('meta export must declare only `meta`');
  }
  const declarator = declaration.declarations[0] as AnyNode;
  if (declarator.id?.type !== 'Identifier' || declarator.id.name !== 'meta') {
    throw new Error('meta export must declare `meta`');
  }
  if (!declarator.init) {
    throw new Error('meta must have a literal value');
  }

  const meta = evaluateLiteral(declarator.init, 'meta');
  validateMeta(meta);

  return {
    meta,
    body: script.slice(0, first.start) + script.slice(first.end),
  };
}

// ---------------------------------------------------------------------------
// Determinism / safety guards
// ---------------------------------------------------------------------------

function assertDeterministicAst(node: AnyNode): void {
  if (isDateNowCall(node) || isMathRandomCall(node) || isNewDateExpression(node)) {
    throw new Error(NONDETERMINISM_ERROR);
  }
  for (const child of astChildren(node)) {
    assertDeterministicAst(child);
  }
}

function assertNoDangerousImports(node: AnyNode): void {
  if (node.type === 'ImportDeclaration' || node.type === 'ImportExpression') {
    throw new Error(
      "Workflow scripts cannot use `import` — only the exposed globals (agent, parallel, pipeline, phase, log, args, cwd, budget) are available.",
    );
  }
  if (node.type === 'CallExpression') {
    const callee = node.callee as AnyNode | undefined;
    if (callee?.type === 'Identifier' && (callee.name === 'require' || callee.name === 'eval')) {
      throw new Error(`Workflow scripts cannot call \`${callee.name}\`.`);
    }
  }
  for (const child of astChildren(node)) {
    assertNoDangerousImports(child);
  }
}

function astChildren(node: AnyNode): AnyNode[] {
  const children: AnyNode[] = [];
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const v of value) {
        if (isAstNode(v)) children.push(v);
      }
    } else if (isAstNode(value)) {
      children.push(value);
    }
  }
  return children;
}

function isAstNode(value: unknown): value is AnyNode {
  return !!value && typeof value === 'object' && typeof (value as AnyNode).type === 'string';
}

function isDateNowCall(node: AnyNode): boolean {
  return node.type === 'CallExpression' && isMemberExpression(node.callee, 'Date', 'now');
}

function isMathRandomCall(node: AnyNode): boolean {
  return node.type === 'CallExpression' && isMemberExpression(node.callee, 'Math', 'random');
}

function isNewDateExpression(node: AnyNode): boolean {
  return (
    node.type === 'NewExpression' &&
    (node.callee as AnyNode | undefined)?.type === 'Identifier' &&
    (node.callee as AnyNode).name === 'Date'
  );
}

function isMemberExpression(
  node: AnyNode | undefined,
  objectName: string,
  propertyName: string,
): boolean {
  if (
    node?.type !== 'MemberExpression' ||
    (node.object as AnyNode | undefined)?.type !== 'Identifier' ||
    (node.object as AnyNode).name !== objectName
  ) {
    return false;
  }
  const prop = node.property as AnyNode | undefined;
  if (!node.computed && prop?.type === 'Identifier') return prop.name === propertyName;
  if (prop?.type === 'Literal' && typeof prop.value === 'string') return prop.value === propertyName;
  return false;
}

// ---------------------------------------------------------------------------
// Literal evaluator (meta must be a pure literal)
// ---------------------------------------------------------------------------

function evaluateLiteral(node: AnyNode, path: string): any {
  switch (node.type) {
    case 'ObjectExpression': {
      const out: Record<string, unknown> = {};
      for (const prop of node.properties as AnyNode[]) {
        if (prop.type === 'SpreadElement') {
          throw new Error(`spread not allowed in ${path}`);
        }
        if (prop.type !== 'Property') {
          throw new Error(`only plain properties allowed in ${path}`);
        }
        if (prop.computed) {
          throw new Error(`computed keys not allowed in ${path}`);
        }
        if (prop.kind !== 'init' || prop.method) {
          throw new Error(`methods/accessors not allowed in ${path}`);
        }
        const key = propertyKey(prop.key as AnyNode, path);
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
          throw new Error(`reserved key name not allowed in ${path}: ${key}`);
        }
        out[key] = evaluateLiteral(prop.value as AnyNode, `${path}.${key}`);
      }
      return out;
    }
    case 'ArrayExpression':
      return (node.elements as Array<AnyNode | null>).map((element, index) => {
        if (!element) throw new Error(`sparse arrays not allowed in ${path}`);
        if (element.type === 'SpreadElement') {
          throw new Error(`spread not allowed in ${path}`);
        }
        return evaluateLiteral(element, `${path}[${index}]`);
      });
    case 'Literal':
      return node.value;
    case 'TemplateLiteral':
      if (node.expressions.length > 0) {
        throw new Error(`template interpolation not allowed in ${path}`);
      }
      return node.quasis
        .map((quasi: AnyNode) => quasi.value.cooked ?? quasi.value.raw)
        .join('');
    case 'UnaryExpression':
      if (
        node.operator === '-' &&
        node.argument?.type === 'Literal' &&
        typeof node.argument.value === 'number'
      ) {
        return -node.argument.value;
      }
      throw new Error(`only negative-number unary allowed in ${path}`);
    default:
      throw new Error(`non-literal node type in ${path}: ${node.type}`);
  }
}

function propertyKey(node: AnyNode, path: string): string {
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'Literal' && (typeof node.value === 'string' || typeof node.value === 'number')) {
    return String(node.value);
  }
  throw new Error(`unsupported key type in ${path}: ${node.type}`);
}

function validateMeta(meta: unknown): asserts meta is WorkflowMeta {
  if (!meta || typeof meta !== 'object') {
    throw new Error('meta must be an object');
  }
  const value = meta as WorkflowMeta;
  if (typeof value.name !== 'string' || !value.name.trim()) {
    throw new Error('meta.name must be a non-empty string');
  }
  if (!/^[a-z][a-z0-9_-]*$/.test(value.name)) {
    throw new Error(
      `meta.name must be lowercase snake_case (got "${value.name}"). Example: "audit_repo".`,
    );
  }
  if (typeof value.description !== 'string' || !value.description.trim()) {
    throw new Error('meta.description must be a non-empty string');
  }
  if (value.whenToUse !== undefined && typeof value.whenToUse !== 'string') {
    throw new Error('meta.whenToUse must be a string');
  }
  if (value.phases !== undefined) {
    if (!Array.isArray(value.phases)) {
      throw new Error('meta.phases must be an array');
    }
    for (const phase of value.phases) {
      if (!phase || typeof phase !== 'object' || typeof (phase as WorkflowMetaPhase).title !== 'string') {
        throw new Error('each meta phase must have a title string');
      }
    }
  }
  if (value.tags !== undefined) {
    if (!Array.isArray(value.tags) || value.tags.some((tag) => typeof tag !== 'string' || !tag.trim())) {
      throw new Error('meta.tags must be an array of non-empty strings');
    }
  }
  if (value.estimatedAgents !== undefined) {
    const est = value.estimatedAgents;
    if (!est || typeof est !== 'object') {
      throw new Error('meta.estimatedAgents must be an object');
    }
    if (typeof est.min !== 'number' || typeof est.max !== 'number' || !Number.isFinite(est.min) || !Number.isFinite(est.max)) {
      throw new Error('meta.estimatedAgents.min and .max must be finite numbers');
    }
    if (est.min < 1 || est.max < est.min) {
      throw new Error('meta.estimatedAgents requires min >= 1 and max >= min');
    }
  }
}
