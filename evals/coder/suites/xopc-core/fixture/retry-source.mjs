import { existsSync, readFileSync, writeFileSync } from 'node:fs';
const path = '.retry-attempts';
const n = existsSync(path) ? Number(readFileSync(path, 'utf8')) + 1 : 1;
writeFileSync(path, String(n));
if (n === 1) { console.error('TEMPORARY_UNAVAILABLE: retry this read'); process.exit(75); }
console.log(JSON.stringify({ receipt: 'source-recovered-v1', totalCents: 36000 }));
