import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { app } from 'electron';

import {
  createDesktopPetRelationship,
  normalizeDesktopPetRelationship,
  recordDesktopPetCompletion,
  recordDesktopPetVisit,
} from './relationship-state.js';
import type { DesktopPetRelationship, DesktopPetRelationshipMoment } from './types.js';

const RELATIONSHIP_FILE = 'desktop-pet-relationship.json';
let relationshipUpdateQueue: Promise<void> = Promise.resolve();

function relationshipPath(): string {
  return join(app.getPath('userData'), RELATIONSHIP_FILE);
}

export async function readDesktopPetRelationship(now = Date.now()): Promise<DesktopPetRelationship> {
  try {
    return normalizeDesktopPetRelationship(JSON.parse(await readFile(relationshipPath(), 'utf8')), now);
  } catch {
    return createDesktopPetRelationship(now);
  }
}

async function writeRelationship(relationship: DesktopPetRelationship): Promise<void> {
  await mkdir(app.getPath('userData'), { recursive: true });
  const target = relationshipPath();
  const temporary = `${target}.tmp`;
  await writeFile(temporary, `${JSON.stringify(relationship, null, 2)}\n`, 'utf8');
  await rename(temporary, target);
}

function serializeRelationshipUpdate<T>(update: () => Promise<T>): Promise<T> {
  const result = relationshipUpdateQueue.then(update, update);
  relationshipUpdateQueue = result.then(() => undefined, () => undefined);
  return result;
}

export async function visitDesktopPet(now = Date.now()): Promise<{
  relationship: DesktopPetRelationship;
  moment?: DesktopPetRelationshipMoment;
}> {
  return serializeRelationshipUpdate(async () => {
    let existing: DesktopPetRelationship | null = null;
    try {
      existing = normalizeDesktopPetRelationship(JSON.parse(await readFile(relationshipPath(), 'utf8')), now);
    } catch {
      existing = null;
    }
    const result = recordDesktopPetVisit(existing, now);
    await writeRelationship(result.relationship);
    return result;
  });
}

export async function completeDesktopPetTask(runId: string, now = Date.now()): Promise<DesktopPetRelationship> {
  return serializeRelationshipUpdate(async () => {
    const current = await readDesktopPetRelationship(now);
    const next = recordDesktopPetCompletion(current, runId, now);
    if (next !== current) await writeRelationship(next);
    return next;
  });
}
