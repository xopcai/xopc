import { randomUUID } from 'node:crypto';
import { realpathSync, statSync } from 'node:fs';
import { basename, isAbsolute, parse } from 'node:path';
import { setImmediate as yieldIO } from 'node:timers/promises';
import { resolveSkillsDir } from '../config/paths.js';
import { resolveWorkspaceSkillsDir } from '../agent/skills/workspace-skills-dir.js';
import { ProjectService } from '../projects/project-service.js';
import { ImportSelectionRepository } from '../storage/sqlite/import-selection-repository.js';
import { listKnowledgeItems } from '../knowledge-memory/index.js';
import { digest } from './files.js';
import { canonicalTarget } from './planner.js';
import { detectImportSources } from './sources.js';
import type { ImportService } from './importService.js';
import { ImportError, type ImportSource, type ImportInventory, type StoredInventory, type StoredInventoryItem, type ImportCandidate, type ImportScan } from './types.js';

export function contextKey(candidate: ImportCandidate) {
  return `product-import:${candidate.source}:${digest(candidate.location)}`;
}
export function existingContext(candidate: ImportCandidate, projectId?: string) {
  return listKnowledgeItems({ canonicalKey: contextKey(candidate), scope: projectId ? { type: 'project', id: projectId } : { type: 'global' },
    statuses: ['active', 'candidate', 'needs_review', 'stale', 'archived', 'rejected'] })[0];
}
export function publicInventory(inventory: StoredInventory): ImportInventory {
  return { id: inventory.id, source: inventory.source, createdAt: inventory.createdAt, expiresAt: inventory.expiresAt,
    complete: inventory.complete, notices: inventory.notices,
    candidates: inventory.candidates.map(({ id, kind, parentId, name, description, displayPath, scope, status, reason, suggested, targetName }) =>
      ({ id, kind, parentId, name, description, displayPath, scope, status, reason, suggested, targetName })) };
}
export function getLiveInventory(owner: string, id: string) {
  const inventory = new ImportSelectionRepository(owner).get('inventory', id);
  if (Date.now() > inventory.expiresAt) throw new ImportError('inventory_stale', 'This list has expired. Refresh it before importing.', 409);
  return inventory;
}
export async function scanProduct(service: ImportService, source: ImportSource, owner = 'gateway-owner'): Promise<ImportInventory> {
  if (!detectImportSources().some(s => s.id === source && s.detected)) throw new ImportError('source_not_found', 'App is unavailable on the xopc device', 404);
  const inventory: StoredInventory = { id: randomUUID(), source, createdAt: Date.now(), expiresAt: Date.now() + 15 * 60_000, candidates: [], notices: [], complete: true, scanIds: [] };
  const budget = { bytes: 0, files: 0 };
  const projects = new ProjectService();
  const addScan = (scan: ImportScan, targetRoot: string, parent?: StoredInventoryItem) => {
    inventory.scanIds.push(scan.id);
    inventory.notices.push(...scan.diagnostics);
    if (scan.diagnostics.length) inventory.complete = false;
    const relevant = { ...scan, candidates: scan.candidates.filter(c => c.scope === (parent ? 'project' : 'user')) };
    const skills = service.describeSkills(relevant, { root: targetRoot, projectId: parent?.projectId });
    for (const candidate of relevant.candidates) {
      if (candidate.kind === 'mcp') {
        inventory.candidates.push({
          id: candidate.id,
          kind: 'connection',
          parentId: parent?.id,
          name: candidate.name,
          description: candidate.description,
          displayPath: candidate.location,
          location: candidate.location,
          scope: candidate.scope,
          status: candidate.compatibility === 'needs_setup' ? 'requires_setup' : 'blocked',
          reason: candidate.findings.join('; ') || undefined,
          suggested: false,
          candidate,
          scanId: scan.id,
        });
        continue;
      }
      const item: StoredInventoryItem = { id: candidate.id, kind: candidate.kind === 'rule' ? 'context' : 'skill', parentId: parent?.id,
        name: candidate.name, description: candidate.description, displayPath: candidate.location, location: candidate.location,
        scope: candidate.scope, status: candidate.compatibility === 'compatible' ? 'ready' : 'blocked', suggested: false,
        reason: candidate.findings.join('; ') || undefined, scanId: scan.id, candidate, targetRoot, projectId: parent?.projectId };
      if (item.kind === 'skill') {
        const state = skills.find(s => s.candidate.id === candidate.id)!;
        item.status = state.status; item.reason = state.reason; item.targetName = state.targetName;
        if (parent && !service.isWorkspaceTrusted(parent.location) && item.status !== 'existing') { item.status = 'blocked'; item.reason = 'Trust this project in Projects before importing its skills.'; }
        item.suggested = item.status === 'ready';
      } else if (item.status === 'ready') {
        const existing = !parent || parent.projectId ? existingContext(candidate, parent?.projectId) : undefined;
        if (existing) {
          item.status = existing.source.hash === candidate.hash ? 'existing' : 'blocked';
          item.reason = item.status === 'blocked' ? 'Previously imported context has changed; existing content will be kept.' : undefined;
        }
      }
      inventory.candidates.push(item);
    }
  };
  const scan = await service.scan({ source, budget });
  addScan(scan, canonicalTarget(resolveSkillsDir()));
  const seen = new Set<string>();
  const paths = scan.projectRoots ?? [];
  const limit = 500;
  if (paths.length > limit) { inventory.complete = false; inventory.notices.push(`${paths.length - limit} project directories were not scanned (limit: ${limit}).`); }
  for (const path of paths.slice(0, limit)) {
    await yieldIO();
    let parent: StoredInventoryItem | undefined;
    try {
      if (!isAbsolute(path) || parse(path).root === path || !statSync(path).isDirectory()) throw new Error('Unavailable project');
      const location = realpathSync(path);
      if (parse(location).root === location) throw new Error('Invalid project');
      if (seen.has(location)) continue;
      seen.add(location);
      const existing = projects.findByWorkspaceRoot(location);
      parent = { id: randomUUID(), kind: 'project', name: existing?.name ?? basename(location), description: '', displayPath: path,
        location, scope: 'project', status: existing ? 'existing' : 'ready', suggested: false, projectId: existing?.id };
      inventory.candidates.push(parent);
      const projectScan = await service.scan({ source, projectRoot: location, projectOnly: true, budget });
      addScan(projectScan, canonicalTarget(resolveWorkspaceSkillsDir(location)), parent);
    } catch {
      inventory.complete = false;
      inventory.notices.push(`${path}: some contents could not be scanned; only listed items can be imported.`);
    }
  }
  const score = (item: StoredInventoryItem) => inventory.candidates.some(c => c.parentId === item.id && ['ready', 'conflict'].includes(c.status)) ? 0 : item.projectId ? 1 : 2;
  const roots = inventory.candidates.filter(c => c.kind === 'project').sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name) || a.location.localeCompare(b.location));
  inventory.candidates = [...inventory.candidates.filter(c => c.scope === 'user'), ...roots.flatMap(p => [p, ...inventory.candidates.filter(c => c.parentId === p.id)])];
  new ImportSelectionRepository(owner).save('inventory', inventory);
  return publicInventory(inventory);
}
export function previewInventoryItem(service: ImportService, owner: string, inventoryId: string, itemId: string) {
  const inventory = getLiveInventory(owner, inventoryId);
  const item = inventory.candidates.find(c => c.id === itemId);
  if (!item) throw new ImportError('not_found', 'Item not found', 404);
  if (item.status === 'blocked') return { text: item.reason ?? '', truncated: false };
  const text = item.kind === 'context' ? item.candidate?.content ?? '' : item.kind === 'skill'
    ? Buffer.from(service.readSnapshot(item.scanId!, item.id).find(f => f.path === 'SKILL.md')!.data, 'base64').toString('utf8')
    : item.kind === 'connection' ? JSON.stringify(item.candidate?.mcp ?? {}, null, 2) : item.displayPath;
  return { text: text.slice(0, 20_000), truncated: text.length > 20_000 };
}
