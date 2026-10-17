import { readFile } from 'node:fs/promises';
import { compareComputerEvaluations } from '../src/computer/evaluation-comparison.js';

const [baselinePath, candidatePath] = process.argv.slice(2);
if (!baselinePath || !candidatePath) throw new Error('Usage: node --import tsx scripts/compare-computer-evaluations.mts <baseline.json> <candidate.json>');
const [baseline, candidate] = await Promise.all([baselinePath, candidatePath].map(async path => JSON.parse(await readFile(path, 'utf8'))));
const comparison = compareComputerEvaluations(baseline, candidate);
console.log(JSON.stringify(comparison, null, 2));
if (!comparison.complete) process.exitCode = 1;
