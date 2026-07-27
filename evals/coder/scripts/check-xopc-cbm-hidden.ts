import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checks } from '../suites/xopc-cbm-pilot/hidden/cbm-regression-check.js';

process.chdir(resolve(dirname(fileURLToPath(import.meta.url)), '../../..'));

for (const [name, check] of Object.entries(checks)) {
  await check();
  console.log(`passed ${name}`);
}
