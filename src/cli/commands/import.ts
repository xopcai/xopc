import { randomUUID } from 'node:crypto';
import { Command } from 'commander';
import { openXopcDatabase, closeXopcDatabase, isXopcDatabaseOpen } from '../../storage/sqlite/connection.js';
import { createRuntimeImportService, recoverCapabilityImports } from '../../imports/runtime.js';
import { importSelection, listImportSources } from '../../imports/productImport.js';
import { scanProduct } from '../../imports/inventory.js';
import { isImportSource } from '../../imports/sources.js';
import { register } from '../registry.js';

export function createImportCommand(): Command {
  return new Command('import').description('Select skills, context and projects to import from another AI app')
    .argument('[source]', 'codex or claude-code; omit to list detected apps')
    .option('--inventory <id>', 'Previously scanned inventory')
    .option('--items <ids>', 'Explicit comma-separated candidate IDs')
    .option('--request-id <id>', 'Unique request ID; reuse when retrying a network request')
    .option('--retry-of <id>', 'Retry failed items from this run')
    .action(async (source: string | undefined, options: { inventory?: string; items?: string; requestId?: string; retryOf?: string }) => {
      const selectedSource = source && isImportSource(source) ? source : undefined;
      if (source && !selectedSource) throw new Error('Unsupported import source');
      if ((options.inventory || options.items || options.requestId || options.retryOf) && (!options.inventory || !options.items || !options.requestId)) throw new Error('--inventory, --items and --request-id must be provided together');
      const opened = !isXopcDatabaseOpen();
      if (opened) openXopcDatabase();
      try {
        await recoverCapabilityImports();
        const service = createRuntimeImportService('gateway-owner');
        if (options.inventory) {
          console.log(JSON.stringify(await importSelection(service, { inventoryId: options.inventory, candidateIds: options.items!.split(',').map(s => s.trim()), requestId: options.requestId!, retryOf: options.retryOf }), null, 2));
          return;
        }
        if (!selectedSource) { console.log(JSON.stringify(listImportSources('gateway-owner'), null, 2)); return; }
        const inventory = await scanProduct(service, selectedSource);
        if (!process.stdin.isTTY || !process.stdout.isTTY) {
          console.log(JSON.stringify(inventory, null, 2));
          console.error('No content imported. Submit --inventory, --items and --request-id to import an explicit selection.');
          return;
        }
        const { checkbox, confirm } = await import('@inquirer/prompts');
        const ids = await checkbox({ message: 'Select content to import (projects and rules are not selected by default)',
          choices: inventory.candidates.map(item => ({ name: `${item.kind}: ${item.name} — ${item.displayPath}${item.targetName && item.targetName !== item.name ? ` → ${item.targetName}` : ''}`,
            value: item.id, checked: item.scope === 'user' && item.suggested,
            disabled: item.status === 'blocked' || (item.status === 'existing' && item.kind !== 'project') ? item.reason ?? 'Already available' : false })) });
        const selected = new Set(ids);
        for (const item of inventory.candidates) {
          if (selected.has(item.id) && item.parentId) selected.add(item.parentId);
          if (item.kind === 'skill' && item.suggested && item.parentId && ids.includes(item.parentId)) selected.add(item.id);
        }
        if (!selected.size) return;
        const summary = inventory.candidates.filter(i => selected.has(i.id)).map(i => `${i.kind}: ${i.name} — ${i.displayPath}`).join('\n');
        if (!await confirm({ message: `Import these ${selected.size} items?\n${summary}`, default: false })) return;
        console.log(JSON.stringify(await importSelection(service, { inventoryId: inventory.id, candidateIds: [...selected], requestId: randomUUID() }), null, 2));
      } finally { if (opened) closeXopcDatabase(); }
    });
}
register({ id: 'import', name: 'import', description: 'Select content from other AI apps', factory: createImportCommand, metadata: { category: 'utility' } });
