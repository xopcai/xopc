import { parseArgs } from 'node:util';

import { ControlStore, readSources } from '../../../../control/store.js';
import { createDashboard } from '../../../../control/server.js';

const { values } = parseArgs({ options: {
  index: { type: 'string', default: '.xopc-evals/control/index.db' },
  sources: { type: 'string' },
  db: { type: 'string' },
  port: { type: 'string', default: '4310' },
  host: { type: 'string', default: '127.0.0.1' },
} });
if (!['127.0.0.1', '::1', 'localhost'].includes(values.host!)) throw new Error('Developer dashboard must bind to loopback');
const store = new ControlStore(values.index!);
if (values.sources) for (const source of readSources(values.sources)) store.import(source);
if (values.db) store.import({ path: values.db, benchmark: 'unknown', kind: 'coder-db', evidenceClass: 'unknown' });
const { server, disconnect } = createDashboard(store);
const refresh = setInterval(() => store.refresh(), 2000);
server.listen(Number(values.port), values.host, () => console.log(`xopc Evals: http://${values.host}:${values.port}`));
const shutdown = () => { clearInterval(refresh); disconnect(); server.close(() => { store.close(); process.exit(0); }); };
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
