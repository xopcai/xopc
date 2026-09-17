import { readFile } from 'node:fs/promises';
import { evaluateComputerRuns } from '../src/computer/evaluation.js';

const [path] = process.argv.slice(2);
if (!path) throw new Error('Usage: node --import tsx scripts/evaluate-computer.mts <report.json>');
const input = JSON.parse(await readFile(path, 'utf8'));
const report = evaluateComputerRuns(input.plan, input.runs);
console.log(JSON.stringify(report, null, 2));
if (!report.betaGatePassed) process.exitCode = 1;
