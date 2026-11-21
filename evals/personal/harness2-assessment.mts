import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

import { reconcileJob } from '../control/reconciliation.js';
import { array, record } from '../control/types.js';
import { expectedMonthResults, matchesMonthResults } from './harness2-table-grade.mjs';

const directory = process.argv[2];
if (!directory) throw new Error('Usage: node --import tsx evals/personal/harness2-assessment.mts <pilot directory>');

const readJson = (path: string) => existsSync(path) ? record(JSON.parse(readFileSync(path, 'utf8'))) : {};
const registration = readJson(join(directory, 'validation-registration.json'));
const compoundCase = String(registration.scenario ?? '');
const expected = expectedMonthResults(String(registration.salesCsv ?? ''));
const salesSha256 = createHash('sha256').update(String(registration.salesCsv ?? '')).digest('hex');
const requiredTitles = ['monthly_summary.csv', 'report.md', 'reproduce.mjs'];

function readTrial(root: string, id: string, scenario: string) {
  const campaign = readJson(join(root, 'campaign.json'));
  const report = readJson(join(root, id, `${scenario}-round-1.json`));
  const timings = record(report.durationMs);
  const benchmark = record(report.benchmark);
  const delivered = array(report.downloads).map(record);
  const preview = array(report.deliveryArtifacts).map(record);
  const audit = reconcileJob(root, id);
  const valid = campaign.validity === 'valid' && campaign.sourceChanged === false
    && benchmark.sourceChangedDuringRun === false && audit.ledgerFinalSnapshotGuaranteed
    && audit.perRequestMatched && audit.usageMatched && audit.unknownRequests === 0
    && audit.physicalRequests > 0 && audit.physicalRequests <= 60
    && record(campaign.pool).maxRequests === 60 && array(report.timeline).some(item => record(item).stage === 'runStarted')
    && (scenario !== compoundCase || benchmark.salesSha256 === salesSha256);
  const visibleFiles = requiredTitles.filter(title =>
    preview.some(artifact => artifact.title === title && artifact.availability === 'available')).length;
  const visibleCompletion = report.deliveryStatus === 'succeeded' ? 1 : 0;
  const restored = array(report.restoredArtifactIds);
  return {
    id, valid, visibleFiles, visibleCompletion, restored: restored.length,
    output: { scenario, table: report.validationTable, attachments: delivered, smokePassed: report.success === true },
    failure: report.failure ?? null, fixture: benchmark.fixtureSha256 ?? null,
    treatment: benchmark.treatmentSha256 ?? null, source: campaign.sourceHash ?? null,
    model: report.models ?? null, acknowledgementMs: timings.initialReplyAfterSubmit ?? null,
    pingMs: timings.pingResponse ?? null, totalMs: timings.total ?? null,
    calls: audit.physicalRequests, tokens: audit.wireTokens, charge: audit.actualCharge,
  };
}

function grade({ output, ...trial }: ReturnType<typeof readTrial>) {
  const csvCorrect = output.scenario === compoundCase && expected.length > 0 && typeof output.table === 'string'
    ? matchesMonthResults(output.table, expected) : null;
  const passed = output.smokePassed && (output.scenario !== compoundCase
    || (csvCorrect === true && trial.visibleFiles === 3 && output.attachments.length === 3
      && output.attachments.every(artifact => Number(artifact.sizeBytes) > 0) && trial.restored === 2));
  return { ...trial, passed, csvCorrect };
}

const development = ['invariant', 'domain', 'combined'].map(id => grade(readTrial(join(directory, `${id}-run`), id, 'file')));
const pairs = [1, 2, 3].map(index => {
  const firstTrial = readTrial(join(directory, `validation-first-${index}`), 'first', compoundCase);
  const secondTrial = readTrial(join(directory, `validation-second-${index}`), 'second', compoundCase);
  const preferSecond = secondTrial.visibleFiles > firstTrial.visibleFiles
    || (secondTrial.visibleFiles === firstTrial.visibleFiles && secondTrial.visibleCompletion > firstTrial.visibleCompletion);
  const first = grade(firstTrial);
  const second = grade(secondTrial);
  const candidate = grade(readTrial(join(directory, `validation-candidate-${index}`), 'candidate', compoundCase));
  return { index, first, second, chosen: preferSecond ? second : first, candidate };
});
const validation = pairs.flatMap(({ first, second, candidate }) => [first, second, candidate]);
const comparable = validation.every(row => row.valid) && new Set(validation.map(row => row.source)).size === 1
  && new Set(validation.map(row => row.fixture)).size === 1 && new Set(validation.map(row => JSON.stringify(row.model))).size === 1
  && pairs.every(({ first, second, candidate }) => first.treatment === null && second.treatment === null
    && typeof registration.combinedSha256 === 'string' && candidate.treatment === registration.combinedSha256);
const wins = pairs.filter(pair => pair.candidate.passed && !pair.chosen.passed).length;
const losses = pairs.filter(pair => !pair.candidate.passed && pair.chosen.passed).length;
const candidateResults = pairs.map(pair => pair.candidate);
const controlResults = pairs.flatMap(({ first, second }) => [first, second]);
const totals = (rows: typeof validation) => ({
  calls: rows.reduce((sum, row) => sum + row.calls, 0),
  tokens: rows.every(row => typeof row.tokens === 'number') ? rows.reduce((sum, row) => sum + Number(row.tokens), 0) : null,
});
const developmentValid = development.every(row => row.valid)
  && typeof registration.combinedSha256 === 'string' && development[2]?.treatment === registration.combinedSha256;
const developmentPassed = developmentValid && development[2]?.passed === true;
const valid = comparable && developmentPassed;
const promoted = valid && wins > losses && candidateResults.every(result => result.passed
  && typeof result.acknowledgementMs === 'number' && result.acknowledgementMs <= 5000
  && typeof result.pingMs === 'number' && result.pingMs <= 5000);
const assessment = {
  valid,
  decision: developmentValid && !developmentPassed ? 'rejected_development'
    : !valid ? 'insufficient_evidence' : promoted ? 'passes_pilot_gate' : 'rejected',
  groups: {
    single: pairs.some(pair => pair.first.valid) ? pairs.filter(pair => pair.first.valid && pair.first.passed).length : null,
    repeated: pairs.some(pair => pair.first.valid && pair.second.valid)
      ? pairs.filter(pair => pair.first.valid && pair.second.valid && pair.chosen.passed).length : null,
    repeatedOracleUpperBound: pairs.some(pair => pair.first.valid && pair.second.valid)
      ? pairs.filter(pair => pair.first.valid && pair.second.valid && (pair.first.passed || pair.second.passed)).length : null,
    candidate: candidateResults.some(row => row.valid) ? candidateResults.filter(row => row.valid && row.passed).length : null,
    expected: pairs.length,
  },
  validValidationTrials: validation.filter(row => row.valid).length,
  wins, losses, fixedHarnessCost: totals(controlResults), candidateCost: totals([...development, ...candidateResults]),
  development, pairs,
};
writeFileSync(join(directory, 'assessment.json'), JSON.stringify(assessment, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ valid, decision: assessment.decision, groups: assessment.groups }, null, 2));
