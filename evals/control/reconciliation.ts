import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { hash } from './evidence.js';
import { array, record, type Row } from './types.js';

const read = (path: string): Row => record(JSON.parse(readFileSync(path, 'utf8')));
const sum = (rows: Row[], key: string): number | null => rows.length && rows.every(r => typeof r[key] === 'number') ? rows.reduce((n, r) => n + Number(r[key]), 0) : null;

/** Reconcile independent HTTP, runtime ledger and task-event observations. Unknowns fail closed. */
export function reconcileJob(directory: string, id: string) {
  const wirePath = join(directory, `${id}-model-requests.jsonl`);
  const events = existsSync(wirePath) ? readFileSync(wirePath, 'utf8').trim().split('\n').filter(Boolean).map(line => record(JSON.parse(line))) : [];
  const starts = events.filter(e => e.event === 'start'), ends = events.filter(e => e.event === 'end');
  const ledgerPath = existsSync(join(directory, id, 'runtime-usage.json')) ? join(directory, id, 'runtime-usage.json') : existsSync(join(directory,id,'runtime-usage-recovered.json')) ? join(directory,id,'runtime-usage-recovered.json') : join(directory, `${id}-runtime-usage.json`);
  const ledger = existsSync(ledgerPath) ? read(ledgerPath) : {};
  const rows = array(ledger.rows).map(record), main = rows.filter(r => String(r.operation).startsWith('agent.'));
  const auxiliary = rows.filter(r => !String(r.operation).startsWith('agent.'));
  const dbPath = join(directory, id, 'benchmark/evals.db');
  let taskResponses = 0, taskTokens: number | null = null;
  if (existsSync(dbPath)) {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const responses = db.prepare("SELECT payload_json FROM eval_run_events WHERE type='model.response' ORDER BY run_id,seq").all()
        .map(e => record(record(JSON.parse(String(e.payload_json))).payload));
      // Trace payload wraps the original realtime event.
      const usage = responses.map(e => record(e.usage));
      taskResponses = responses.length; taskTokens = sum(usage, 'total');
    } finally { db.close(); }
  }
  const duplicates = starts.length !== new Set(starts.map(e => e.requestId)).size || ends.length !== new Set(ends.map(e => e.requestId)).size;
  const completed = !duplicates && starts.length > 0 && starts.length === ends.length && starts.every(e => ends.some(end => end.requestId === e.requestId && end.lease === e.lease))
    && ends.every(e => !e.error && Number(e.status) >= 200 && Number(e.status) < 300 && !e.overflow);
  const observedWireTokens = sum(ends.map(e => record(e.usage)).filter(u => typeof u.total === 'number'), 'total');
  const wireTokens = completed ? observedWireTokens : null;
  const observedRuntimeTokens = sum(rows.filter(r => ['succeeded','failed','aborted'].includes(String(r.status))), 'total_tokens');
  const runtimeTokens = sum(rows, 'total_tokens'), auxiliaryTokens = auxiliary.length ? sum(auxiliary, 'total_tokens') : 0;
  const primaryTokens = sum(main, 'total_tokens');
  const taskEventsAvailable = existsSync(dbPath);
  const requestInventoryMatched = starts.length > 0 && rows.length === starts.length && (!taskEventsAvailable || main.length === taskResponses);
  const requestCountMatched = completed && requestInventoryMatched && rows.every(r => ['succeeded','failed','aborted'].includes(String(r.status)));
  const usageMatched = requestCountMatched && wireTokens !== null && wireTokens === runtimeTokens && (!taskEventsAvailable || taskTokens === primaryTokens);
  const linked = ends.filter(e => typeof e.cloudRequestId === 'string').map(end => {
    const matches = rows.filter(r => r.cloud_request_id === end.cloudRequestId);
    const row = matches.length === 1 ? matches[0]! : undefined;
    const start = starts.find(s => s.requestId === end.requestId);
    const usageEventIdentityMatched = !!row && start?.usageEventId === row.id;
    return {requestId:end.requestId,cloudRequestId:end.cloudRequestId,runtimeEventId:row?.id ?? null,providerTokens:record(end.usage).total ?? null,runtimeTokens:row?.total_tokens ?? null,
      usageEventIdentityMatched, matched:usageEventIdentityMatched && !!row && row.total_tokens === record(end.usage).total && ['succeeded','failed','aborted'].includes(String(row.status))};
  });
  const knownLinks = linked.filter(r => typeof r.providerTokens === 'number' && typeof r.runtimeTokens === 'number');
  const knownPerRequestUsageMatched = knownLinks.length > 0 && knownLinks.every(r => r.matched);
  const perRequestMatched = requestCountMatched && linked.length === starts.length && new Set(linked.map(r=>r.cloudRequestId)).size === starts.length && linked.every(r=>r.matched);
  const receipts = rows.map(r => r.cloud_billing_json ? record(JSON.parse(String(r.cloud_billing_json))) : null);
  const settled = receipts.length > 0 && receipts.every(r => r && ['settled','released'].includes(String(r.state)) && typeof r.chargedCreditMicro === 'string');
  const settledChargeCreditMicro = settled ? receipts.reduce((n,r)=>n + BigInt(String(r!.chargedCreditMicro)),0n).toString() : null;
  return { id, taskEventsAvailable, knownPerRequestUsageMatched, knownUsageRequests:knownLinks.length, perRequestMatched, requestLinks:linked, settledChargeCreditMicro, billingUnit:'credit-micro', physicalRequests: starts.length, completedRequests: ends.length, runtimeRequests: rows.length, taskResponses,
    auxiliaryRequests: auxiliary.length, auxiliaryOperations: [...new Set(auxiliary.map(r => r.operation))], observedRuntimeTokens, observedProviderMinusRuntimeTokens: observedWireTokens !== null && observedRuntimeTokens !== null ? observedWireTokens - observedRuntimeTokens : null, unknownRequests: starts.filter(e => !ends.some(end => end.requestId === e.requestId && !end.error && record(end.usage).total !== undefined)).length, observedWireTokens, wireTokens, runtimeTokens, taskTokens, auxiliaryTokens,
    providerMinusRuntimeTokens: wireTokens !== null && runtimeTokens !== null ? wireTokens - runtimeTokens : null,
    requestInventoryMatched, requestCountMatched, usageMatched, requestedModels: [...new Set(starts.map(e => e.model))], responseModels: [...new Set(ends.map(e => e.responseModel).filter(Boolean))], ledgerMode:ledger.mode ?? null, ledgerFinalSnapshotGuaranteed: ledger.finalSnapshotGuaranteed === true,
    actualCharge: settled ? {unit:'credit_micro',value:settledChargeCreditMicro} : null, actualChargeReason: settled ? 'All isolated runtime rows have settled/released authoritative Cloud receipts.' : 'No complete settled per-request billing receipts; local estimates are not charges.',
    coverage: 'Declared model endpoint fetch transport only; counts cross-checked against isolated runtime ledger and task events.',
    files: { wire: wirePath, ledger: ledgerPath },
    hashes: { wire: existsSync(wirePath) ? hash(readFileSync(wirePath, 'utf8')) : null, ledger: existsSync(ledgerPath) ? hash(readFileSync(ledgerPath, 'utf8')) : null },
  };
}

/** A predeclared small pilot gate; never changes production defaults. */
export function assessCycle(directory: string, registrationPath: string, validationDirectory = directory) {
  const registration = read(registrationPath), campaign = read(join(directory, 'campaign.json'));
  const threshold = record(registration.gate).minTokenReduction;
  if (typeof threshold !== 'number' || threshold < 0 || threshold > 1 || !array(registration.development).length || !array(registration.independentValidation).length
    || array(registration.development).some(id => array(registration.independentValidation).includes(id))) throw new Error('Invalid predeclared gate or overlapping validation selection');
  const directoryFor = (id: string) => id.startsWith('validation') ? validationDirectory : directory;
  const jobs = ['development-baseline', 'development-candidate', 'validation-baseline', 'validation-candidate'];
  const reasons: string[] = [];
  if (!(Date.parse(String(registration.registeredAt)) < Date.parse(String(campaign.startedAt)))) reasons.push('Registration was not frozen before execution');
  if (campaign.validity !== 'valid' || campaign.sourceChanged !== false) reasons.push('Campaign source or execution validity is not established');
  const reports = jobs.map(id => {
    const path = join(directoryFor(id), id, 'benchmark/summary.json'), manifestPath = join(directoryFor(id), id, 'benchmark/manifest.json');
    if (!existsSync(path) || !existsSync(manifestPath)) { reasons.push(`${id}: missing result`); return { id, passed: 0, expected: 2, cases: [], manifest: {} as Row }; }
    const report = read(path), manifest = read(manifestPath), cases = array(report.cases).map(record);
    const expectedIds = array(id.startsWith('validation') ? registration.independentValidation : registration.development).map(String).sort();
    if (JSON.stringify(cases.map(c => String(c.caseId)).sort()) !== JSON.stringify(expectedIds) || manifest.sourceDrift !== false) reasons.push(`${id}: selection or source drift`);
    const expectedTurns = id.endsWith('baseline') ? 40 : 8;
    if (record(manifest.harnessTreatment).maxTurns !== expectedTurns || manifest.model !== registration.model || manifest.reasoning !== registration.reasoning) reasons.push(`${id}: treatment/model mismatch`);
    return { id, passed: cases.filter(c => c.status === 'passed' && c.artifactChecksPassed === true).length, expected: expectedIds.length, cases, manifest };
  });
  for (const phase of ['development', 'validation']) {
    const a = reports.find(r => r.id === `${phase}-baseline`)!, b = reports.find(r => r.id === `${phase}-candidate`)!;
    for (const key of ['suiteHash','selectionHash','graderHash','fixtureCommit','model','reasoning','environmentHash','lockfileHash','sourceHashes']) {
      if (JSON.stringify(a.manifest[key]) !== JSON.stringify(b.manifest[key]) || a.manifest[key] === undefined) reasons.push(`${phase}: incomparable ${key}`);
    }
    if (a.passed !== a.expected) reasons.push(`${phase}: baseline not fully successful`);
    if (b.passed !== b.expected) reasons.push(`${phase}: candidate incomplete or incorrect (${b.passed}/${b.expected})`);
  }
  if (validationDirectory !== directory) {
    const validation = read(join(validationDirectory, 'campaign.json'));
    if (validation.validity !== 'valid' || validation.sourceChanged !== false) reasons.push('Independent validation infrastructure not valid');
  }
  const audit = jobs.map(id => reconcileJob(directoryFor(id), id));
  if (audit.some(a => a.requestedModels.some(m => m !== String(registration.model).split('/').slice(1).join('/')))) reasons.push('Unexpected physical request model');
  if (audit.some(a => !a.requestCountMatched)) reasons.push('Physical requests, runtime rows and task plus auxiliary responses do not reconcile');
  if (audit.some(a => !a.usageMatched)) reasons.push('Provider token totals and runtime/task usage do not reconcile');
  const total = (suffix: string) => { const selected = audit.filter(a => a.id.endsWith(suffix)); return selected.every(a => a.wireTokens !== null) ? selected.reduce((n,a) => n + a.wireTokens!,0) : null; };
  const baselineTokens = total('baseline'), candidateTokens = total('candidate');
  const tokenReduction = baselineTokens && candidateTokens !== null ? 1 - candidateTokens / baselineTokens : null;
  if (tokenReduction === null || tokenReduction < Number(record(registration.gate).minTokenReduction)) reasons.push('Token reduction did not meet the predeclared gate');
  return { schemaVersion: 1, decidedAt: new Date().toISOString(), promotion: reasons.length ? 'rejected' : 'promoted', scope: 'bounded controlled pilot only',
    productionDefaultsChanged: false, reasons, preregistrationHash: hash(readFileSync(registrationPath,'utf8')),
    campaignId: campaign.id, sourceHash: campaign.sourceHash, reports: reports.map(({manifest: _manifest, ...r}) => r), audit,
    baselineTokens, candidateTokens, tokenReduction, independentValidation: registration.independence,
    limitations: ['One repetition per case; no statistical/general production improvement claim.', 'Financial settlement remains unknown without authoritative receipts.', 'Live sidecar ledger snapshots may precede final cleanup; incomplete observations block promotion.'] };
}
