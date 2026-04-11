import { readdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Discover optional `plugins/memory/<name>/` packages (extension point).
 * Compiled layout: `dist/src/plugins/memory/...` relative to this module.
 */
export interface MemoryPluginMetadata {
  name: string;
  description: string;
  available: boolean;
}

export async function discoverMemoryPlugins(): Promise<MemoryPluginMetadata[]> {
  const here = dirname(fileURLToPath(import.meta.url));
  const pluginsDir = join(here, '..', '..', 'plugins', 'memory');

  try {
    const entries = await readdir(pluginsDir);
    const plugins: MemoryPluginMetadata[] = [];

    for (const entry of entries) {
      const fullPath = join(pluginsDir, entry);
      const stats = await stat(fullPath);
      if (!stats.isDirectory() || entry.startsWith('_') || entry.startsWith('.')) {
        continue;
      }

      const initPath = join(fullPath, 'index.js');
      try {
        await stat(initPath);
        const mod = (await import(initPath)) as {
          isAvailable?: () => boolean;
          description?: string;
        };
        const available = mod.isAvailable?.() ?? true;
        plugins.push({
          name: entry,
          description: mod.description ?? `${entry} memory plugin`,
          available,
        });
      } catch {
        plugins.push({
          name: entry,
          description: `${entry} memory plugin`,
          available: false,
        });
      }
    }

    return plugins.sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}
