import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const directory = resolve(process.argv[2]);
const summary = JSON.parse(readFileSync(join(directory, 'summary.json'), 'utf8'));
const reviewPath = join(directory, 'semantic-review.json');
const reviews = existsSync(reviewPath) ? JSON.parse(readFileSync(reviewPath, 'utf8')) : [];
const rows = summary.manifest.caseIds.flatMap((caseId: string) => Array.from({ length: summary.manifest.repeats }, (_, index) =>
  summary.manifest.arms.map((arm: string) => {
    const path = join(directory, `${caseId}-${index + 1}-${arm}.json`);
    if (!existsSync(path)) return undefined;
    const source = readFileSync(path, 'utf8');
    const row = JSON.parse(source);
    const checks = { ...row.checks };
    const review = reviews.find((value: any) => value.file === basename(path));
    if (review) {
      if (review.sha256 !== createHash('sha256').update(source).digest('hex')) throw new Error('Reviewed receipt changed: ' + path);
      for (const [key, value] of Object.entries(review.overrides)) {
        if (!['notClaimedDone', 'honestPending', 'noUnverifiedReady'].includes(key) || typeof value !== 'boolean') throw new Error('Review cannot override persisted state, permission, calls or runtime errors');
        checks[key] = value;
      }
    }
    return { caseId, arm, repeat: index + 1, rawPassed: row.passed, passed: Boolean(row.outcome?.ok) && Object.keys(checks).length > 0 && Object.values(checks).every(Boolean),
      checks, review, requests: row.requests, inputTokens: row.input + row.cacheRead, outputTokens: row.output,
      firstRequestInputTokens: row.firstRequestInputTokens, systemPromptChars: row.systemPromptChars,
      guidanceChars: row.guidanceChars, toolSchemaChars: row.toolSchemaChars,
      elapsedMs: row.elapsedMs, path, calls: row.calls, reply: row.reply };
  })).flat()).filter(Boolean);
const groups = Object.fromEntries(summary.manifest.arms.map((arm: string) => [arm, {
  ...summary.groups[arm], rawPassed: summary.groups[arm].passed, passed: rows.filter((row: any) => row.arm === arm && row.passed).length,
  failedChecks: rows.filter((row: any) => row.arm === arm).reduce((sum: number, row: any) => sum + Object.values(row.checks).filter(value => !value).length, 0),
}]));
const paired: Record<string, unknown> = {};
for (let i = 0; i < summary.manifest.arms.length; i++) for (const right of summary.manifest.arms.slice(i + 1)) {
  const left = summary.manifest.arms[i]; let wins = 0, losses = 0, ties = 0;
  for (const row of rows.filter((row: any) => row.arm === left)) {
    const other = rows.find((candidate: any) => candidate.arm === right && candidate.caseId === row.caseId && candidate.repeat === row.repeat);
    if (!other) continue;
    if (row.passed && !other.passed) wins++; else if (!row.passed && other.passed) losses++; else ties++;
  }
  paired[`${left}:${right}`] = { wins, losses, ties };
}
const result = { status: summary.status, manifest: summary.manifest, groups, paired, reviews,
  samples: rows, failures: rows.filter((row: any) => !row.passed) };
writeFileSync(join(directory, 'reviewed-summary.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ status: result.status, groups, paired, reviewedSamples: reviews.length, failures: result.failures.map((row: any) => ({ caseId: row.caseId, arm: row.arm, repeat: row.repeat, checks: row.checks })) }));
