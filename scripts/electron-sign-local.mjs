#!/usr/bin/env node
/** Local signing/notarization entrypoint; credentials come from .env.local or the environment. */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadElectronSigningEnv } from './electron-signing-env.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const env = loadElectronSigningEnv(root);
const result = spawnSync(process.execPath, [join(root, 'scripts/electron-builder.mjs'), ...process.argv.slice(2)], {
  env,
  cwd: root,
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
