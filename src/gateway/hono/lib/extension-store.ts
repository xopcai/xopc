import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Extension UI: write-through JSON KV per namespace under ~/.xopc/extensions/{namespace}/storage.json */
const extensionStoreCache = new Map<string, Record<string, unknown>>();

function getExtensionStorePath(namespace: string): string {
  const safeNamespace = namespace.replace(/[^a-zA-Z0-9_-]/g, '_');
  return join(homedir(), '.xopc', 'extensions', safeNamespace, 'storage.json');
}

export async function loadExtensionStore(namespace: string): Promise<Record<string, unknown>> {
  const cached = extensionStoreCache.get(namespace);
  if (cached) return cached;

  const filePath = getExtensionStorePath(namespace);
  try {
    const raw = await readFile(filePath, 'utf-8');
    const data = JSON.parse(raw) as Record<string, unknown>;
    extensionStoreCache.set(namespace, data);
    return data;
  } catch {
    const empty: Record<string, unknown> = {};
    extensionStoreCache.set(namespace, empty);
    return empty;
  }
}

export async function saveExtensionStore(namespace: string, data: Record<string, unknown>): Promise<void> {
  const filePath = getExtensionStorePath(namespace);
  await mkdir(join(filePath, '..'), { recursive: true });
  await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
  extensionStoreCache.set(namespace, data);
}
