import { Command } from 'commander';
import { openXopcDatabase, closeXopcDatabase, isXopcDatabaseOpen } from '../../storage/sqlite/connection.js';
import { createRuntimeImportService, recoverCapabilityImports } from '../../imports/runtime.js';
import { importProduct, listImportSources } from '../../imports/productImport.js';
import { isImportSource } from '../../imports/sources.js';
import { register } from '../registry.js';

export function createImportCommand(): Command {
  return new Command('import').description('Import skills, context and projects from another AI app')
    .argument('[source]', 'codex or claude-code; omit to list detected apps')
    .action(async (source?: string) => {
      const selected = source && isImportSource(source) ? source : undefined;
      if (source && !selected) throw new Error('Unsupported import source');
      const opened = !isXopcDatabaseOpen();
      if (opened) openXopcDatabase();
      try {
        await recoverCapabilityImports();
        console.log(JSON.stringify(selected
          ? await importProduct(createRuntimeImportService('gateway-owner'), selected)
          : listImportSources('gateway-owner'), null, 2));
      } finally { if (opened) closeXopcDatabase(); }
    });
}
register({ id: 'import', name: 'import', description: 'Import from other AI apps', factory: createImportCommand, metadata: { category: 'utility' } });
