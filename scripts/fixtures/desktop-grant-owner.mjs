// Test-only abrupt-owner fixture. No execution, credentials or native consent is synthesized.
import { DesktopExecutionGrantLedger } from '../../electron/desktop/execution-grant-ledger.ts';
import { DesktopExecutionLease, DesktopOperationJournal } from '../../electron/desktop/operation-journal.ts';

const input = JSON.parse(process.env.XOPC_TEST_GRANT_INPUT);
const encryption = { available: async () => true, encrypt: async value => Buffer.from(value), decrypt: async bytes => bytes.toString() };
const lease = new DesktopExecutionLease(input.executorRoot), journal = new DesktopOperationJournal(lease);
const record = { ...input.record, parentPid: process.pid, leaseGeneration: lease.generation };
await new DesktopExecutionGrantLedger(input.directory, encryption).save(record);
if (input.intent) { journal.record(input.intent); journal.start(input.intent, { invocationId: input.invocationId, connectionInstanceId: input.connectionInstanceId }); }
process.send({ record });
setInterval(() => {}, 1000);
