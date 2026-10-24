import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { PhoneAction, PhoneDecision, PhoneObservation } from '../../src/phone/contracts.js';

export const SNAPSHOT_FILES = ['runtime.ts', 'model-adapter.ts', 'adb-driver.ts', 'contracts.ts', 'reliability.ts'] as const;
export type ArmName = 'baseline' | 'optimized';
export type NativeFacts = ReturnType<typeof nativeFacts>;
export type TrialTrace = Array<Record<string, unknown>>;

export async function sourceHashes(directory: string): Promise<Record<string, string>> {
  return Object.fromEntries(await Promise.all(SNAPSHOT_FILES.map(async name => [name, createHash('sha256').update(await readFile(join(directory, name))).digest('hex')])));
}

/** Baselines copy all changed phone modules so fixes cannot leak through shared imports. */
export async function loadBaseline(root: string, source: string, destination: string) {
  await mkdir(destination, { recursive: true });
  const manifestPath = join(source, 'manifest.json');
  const manifest = existsSync(manifestPath) ? JSON.parse(await readFile(manifestPath, 'utf8')) as { sourceSha256?: Record<string, string> } : undefined;
  const hashes = await sourceHashes(source);
  const currentContracts = createHash('sha256').update(await readFile(join(root, 'src/phone/contracts.ts'))).digest('hex');
  const canonicalContracts = currentContracts === hashes['contracts.ts'];
  if (manifest?.sourceSha256) for (const name of SNAPSHOT_FILES) assert.equal(hashes[name], manifest.sourceSha256[name], `Baseline ${name} differs from its manifest`);
  for (const name of SNAPSHOT_FILES) {
    const input = await readFile(join(source, name), 'utf8');
    const rebound = input.replace(/((?:from\s+|import\s*\()\s*['"])(\.[^'"]+)(['"])/g, (_match, prefix: string, specifier: string, suffix: string) => {
      const original = resolve(root, 'src/phone', specifier);
      const typescript = original.replace(/\.js$/, '.ts');
      const file = basename(typescript);
      const path = file === 'contracts.ts' && dirname(typescript) === resolve(root, 'src/phone') && canonicalContracts ? typescript : dirname(typescript) === resolve(root, 'src/phone') && SNAPSHOT_FILES.includes(file as typeof SNAPSHOT_FILES[number])
        ? join(destination, file) : existsSync(typescript) ? typescript : original;
      return `${prefix}${pathToFileURL(path).href}${suffix}`;
    });
    await writeFile(join(destination, name), rebound);
  }
  const [runtime, model, driver] = await Promise.all(['runtime.ts', 'model-adapter.ts', 'adb-driver.ts'].map(file => import(pathToFileURL(join(destination, file)).href)));
  return { runtime, model, driver, hashes, canonicalContracts };
}

export function visibleNode(node: PhoneObservation['elements'][number], screen: PhoneObservation): boolean {
  return !node.password && node.bounds[0] >= 0 && node.bounds[1] >= 0 && node.bounds[2] <= screen.width && node.bounds[3] <= screen.height
    && node.bounds[2] > node.bounds[0] && node.bounds[3] > node.bounds[1];
}

export function texts(screen: PhoneObservation): string[] {
  return screen.elements.filter(node => visibleNode(node, screen)).flatMap(node => [node.text, node.description]).filter(Boolean);
}

export function nativeFacts(screen: PhoneObservation) {
  return { package: screen.package, width: screen.width, height: screen.height, rotation: screen.rotation,
    nodes: screen.elements.filter(node => !node.password && (node.text || node.description || node.focused))
      .slice(0, 140).map(node => ({ text: node.text.slice(0, 180), description: node.description.slice(0, 180),
        resourceId: node.resourceId, focused: node.focused, editable: Boolean(node.editable), bounds: node.bounds,
        fullyWithinScreen: visibleNode(node, screen) })) };
}

export function fingerprint(screen: PhoneObservation): string {
  return createHash('sha256').update(JSON.stringify({ package: screen.package, width: screen.width, height: screen.height, rotation: screen.rotation,
    nodes: screen.elements.filter(node => !node.password).map(node => ({ ...node,
      text: node.resourceId === 'com.android.systemui:id/clock' ? '' : node.text,
      description: node.resourceId === 'com.android.systemui:id/clock' ? '' : node.description })) })).digest('hex');
}

export function decisionTrace(decision: PhoneDecision): Record<string, unknown> {
  if (decision.kind === 'action') return { kind: decision.kind, action: actionTrace(decision.action) };
  return decision.kind === 'complete' ? { kind: decision.kind, summary: decision.summary.slice(0, 500) }
    : { kind: decision.kind, reason: decision.reason.slice(0, 500) };
}
function actionTrace(action: PhoneAction): PhoneAction {
  return action.type === 'typeText' ? { ...action, text: action.text.slice(0, 500) } : action;
}

export function errorCode(error: unknown): string {
  return error && typeof error === 'object' && 'code' in error ? String(error.code) : error instanceof Error ? error.name : 'BENCHMARK_ERROR';
}
