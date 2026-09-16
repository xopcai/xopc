import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { isValidSkillId } from '../agent/skills/managed-store.js';
import { parseSkill } from './compatibility.js';
import { digest, fileHash, IMPORT_LIMITS, readTree } from './files.js';
import { ImportError, type ImportAction, type ImportPlan, type ImportScan, type ImportTarget } from './types.js';

export function targetInventory(root: string): Array<{ directory: string; name: string; hash: string }> {
  if (!existsSync(root)) return [];
  let bytes = 0;
  let count = 0;
  return readdirSync(root, { withFileTypes: true }).filter(e => !e.name.startsWith('.')).map(entry => {
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw new ImportError('unsafe_target', 'Target contains a link or non-directory item', 409);
    const files = readTree(join(root, entry.name));
    bytes += files.reduce((n, f) => n + Buffer.byteLength(f.data, 'base64'), 0);
    count += files.length;
    if (bytes > IMPORT_LIMITS.total || count > IMPORT_LIMITS.count) throw new ImportError('limit_exceeded', 'Target inventory exceeds import limits', 413);
    const primary = files.find(f => f.path === 'SKILL.md');
    let name = entry.name;
    try { if (primary) name = String(parseSkill(Buffer.from(primary.data, 'base64').toString('utf8')).metadata.name); } catch { /* Directory still reserves its name. */ }
    return { directory: entry.name, name, hash: fileHash(files) };
  }).sort((a, b) => a.directory.localeCompare(b.directory));
}
export function targetRevision(root: string): string { return digest(targetInventory(root)); }
export function canonicalTarget(root: string): string {
  let current = resolve(root);
  while (!existsSync(current)) {
    const parent = resolve(current, '..');
    if (parent === current) break;
    current = parent;
  }
  return join(realpathSync(current), relative(current, resolve(root)));
}
export function createImportPlan(scan: ImportScan, target: ImportTarget, choices: Array<Pick<ImportAction, 'candidateId' | 'operation'> & { name?: string }>, reservedNames: string[] = []): ImportPlan {
  if (Date.now() - scan.createdAt > 24 * 60 * 60 * 1000) throw new ImportError('plan_stale', 'Scan expired; scan again', 409);
  target = { ...target, root: canonicalTarget(target.root) };
  const inventory = targetInventory(target.root);
  const used = new Set<string>();
  const candidates = new Set<string>();
  const normalize = (s: string) => s.normalize('NFC').toLowerCase();
  const actions: ImportAction[] = choices.map(choice => {
    const item = scan.candidates.find(c => c.id === choice.candidateId);
    if (!item || candidates.has(item.id)) throw new ImportError('invalid_selection', 'Invalid or duplicate candidate');
    candidates.add(item.id);
    const name = choice.name ?? item.name;
    if (!isValidSkillId(name)) throw new ImportError('invalid_name', 'Choose a name using letters, numbers, dot, dash or underscore');
    if (choice.operation !== 'skip' && !['compatible', 'needs_setup'].includes(item.compatibility)) throw new ImportError('incompatible', 'Selected item requires manual adaptation');
    if (item.scope === 'project' && !target.projectId && choice.operation !== 'skip') throw new ImportError('scope_mismatch', 'Project capabilities must remain project-scoped');
    if (item.kind !== 'skill' && choice.operation !== 'skip' && choice.operation !== 'create') throw new ImportError('invalid_operation', 'MCP drafts only support create');
    const existing = item.kind === 'skill' ? inventory.find(e => normalize(e.directory) === normalize(name) || normalize(e.name) === normalize(name)) : undefined;
    const hash = existing?.hash ?? null;
    if (choice.operation !== 'skip') {
      const key = `${item.kind}:${normalize(name)}`;
      if (used.has(key)) throw new ImportError('conflict', 'Two selected items have the same target name', 409);
      used.add(key);
      if (existing?.hash === item.hash && choice.operation === 'create') return { candidateId: item.id, operation: 'skip', name, beforeHash: hash };
      if (choice.operation === 'replace') {
        if (!existing || existing.directory !== name || existing.name !== name) throw new ImportError('conflict', 'Replace requires an exact managed directory and skill name match', 409);
      } else if (existing || (item.kind === 'skill' && reservedNames.some(n => normalize(n) === normalize(name)))) {
        throw new ImportError('conflict', 'Name is already used; choose another name or explicitly replace a managed skill', 409);
      }
      if (choice.operation === 'create' && name !== item.name) throw new ImportError('invalid_operation', 'Use rename when changing the skill name');
    }
    return { candidateId: item.id, operation: choice.operation, name, beforeHash: hash };
  });
  if (!actions.length) throw new ImportError('invalid_selection', 'Select at least one item');
  return { id: randomUUID(), scanId: scan.id, createdAt: Date.now(), expiresAt: Date.now() + 24 * 60 * 60 * 1000, target, targetRevision: digest(inventory), actions };
}
