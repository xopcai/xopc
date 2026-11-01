import { closeSync, fsyncSync, openSync, writeSync } from 'node:fs';
import { join } from 'node:path';

const file = openSync(join(process.argv[2]!, 'supervised-effect.txt'), 'a', 0o600);
try { writeSync(file, 'one-effect\n'); fsyncSync(file); } finally { closeSync(file); }
process.send?.('effect-recorded');
setInterval(() => {}, 1000);
