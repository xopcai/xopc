/** Keep the historical extension command as a narrow wrapper around the shared generator. */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const generator = join(scriptDir, '../../../scripts/generate-brand-assets.mjs');
const result = spawnSync(process.execPath, [generator, '--target=browser-ext'], { stdio: 'inherit' });

process.exit(result.status ?? 1);
