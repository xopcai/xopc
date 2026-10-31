import { randomUUID } from 'node:crypto';
import { closeSync, fsyncSync, openSync, writeSync } from 'node:fs';
import { join } from 'node:path';

import { DesktopExecutionLease, DesktopOperationJournal } from '../../../../electron/desktop/operation-journal.js';

const lease = new DesktopExecutionLease(process.argv[2]!);
const journal = new DesktopOperationJournal(lease);
const operation = JSON.parse(process.argv[3]!);
if (!journal.record(operation).fresh) throw new Error('Duplicate fixture execution');
journal.start(operation, { invocationId: randomUUID(), connectionInstanceId: randomUUID() });
const file = openSync(join(process.argv[2]!, 'synthetic-effect.txt'), 'a', 0o600);
try { writeSync(file, 'one-effect\n'); fsyncSync(file); } finally { closeSync(file); }
process.send?.('effect-complete-without-result');
setInterval(() => {}, 1000);
