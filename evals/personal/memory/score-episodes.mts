import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export interface EpisodeGold {
  mode?: 'forget' | 'quoted-negative';
  forbidden: string[];
  current: string[];
  keepers: string[];
  authorizedIndex: number;
  authorizedIndices?: number[];
  ordinaryIndices: number[];
}
const months: Record<string, number> = Object.fromEntries(['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].map((name,index) => [name,index+1]));
const monthPattern = '(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\\.?';
const text = (value: unknown) => (typeof value === 'string' ? value : JSON.stringify(value)).normalize('NFKC')
  .replace(new RegExp(`\\b${monthPattern}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'giu'),
    (_match, month: string, day: string) => `${months[month.slice(0,3).toLowerCase()]}月${Number(day)}日`)
  .replace(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${monthPattern}\\b`, 'giu'),
    (_match, day: string, month: string) => `${months[month.slice(0,3).toLowerCase()]}月${Number(day)}日`)
  .replace(/(\d),(?=\d{3}(?:\D|$))/gu, '$1').replace(/\s+/gu, '').toLowerCase();
const has = (value: unknown, patterns: string[]) => patterns.some(pattern => new RegExp(pattern, 'iu').test(text(value)));
const active = (state: any) => [...(state.knowledge ?? []).filter((r: any) => r.status === 'active').map((r: any) => r.content),
  ...(state.assertions ?? []).filter((r: any) => r.status === 'active').map((r: any) => r.statement)].join('\n');

/** Parent-only checks: gold never enters capture, and raw retained provenance is not scored as disclosure. */
export function evaluateEpisode(gold: EpisodeGold, data: { initial: any; live: any; learning: any; result: any; inputs: any[] }) {
  const receipts = data.live.liveReceipts ?? [];
  const retained = (value: unknown) => gold.keepers.every(keeper => text(value).includes(text(keeper)));
  const safe = (value: unknown) => !has(value, gold.forbidden);
  const inputFor = (phase: string) => data.inputs.filter(row => row.phase === phase).map(row => row.payload);
  const ordinary = gold.ordinaryIndices.map(index => ({ index, found: inputFor(`live:${index}`), receipt: receipts[index] }));
  const reliabilityChecks = [data.initial, ...receipts, data.learning].map(row => row.reliability);
  const reliability = { passed: reliabilityChecks.length === receipts.length + 2 && reliabilityChecks.every(row => row && row.errors === 0 && row.pending === 0 && row.failedExtractions === 0 && row.successfulJobs > 0), checkpoints: reliabilityChecks };
  const initial = has(active(data.initial), gold.current) && retained(active(data.initial));
  if (gold.mode === 'quoted-negative') {
    const checks = [
      { name: 'initial_target_and_keepers', passed: initial },
      { name: 'quoted_forget_does_not_delete', passed: receipts.every((r: any) => has(active(r), gold.current)) },
      { name: 'ordinary_query_remains_answerable', passed: has(data.result.answer, gold.current) && retained(data.result.answer) },
      { name: 'restart_preserves_target', passed: has(active(data.learning), gold.current) && retained(active(data.learning)) },
    ];
    return { validatorVersion: 3, reliability, passed: reliability.passed && checks.every(row => row.passed), checks, worlds: 1, checkpoints: 4 };
  }
  const afterForget = receipts[0];
  const authorizedIndices = gold.authorizedIndices ?? [gold.authorizedIndex];
  const detail = ordinary.map(({ index, found, receipt }) => ({ index, inputPresent: found.length > 0,
    inputsSafe: safe(found), answerSafe: safe(receipt?.answer ?? ''), stateSafe: !!receipt && safe(active(receipt)),
    keepersPresent: !!receipt && retained(active(receipt)) }));
  const finalInputs = inputFor('answer');
  const checks = [
    { name: 'initial_target_and_keepers', passed: initial },
    { name: 'forget_state_and_ordinary_projection', passed: !!afterForget && safe(active(afterForget)) && retained(active(afterForget))
      && detail.filter(row => row.index < gold.authorizedIndex).every(row => row.inputPresent && row.inputsSafe && row.answerSafe && row.stateSafe && row.keepersPresent) },
    { name: 'current_authorized_read_without_restore', passed: authorizedIndices.every(index => {
      const authorized = receipts[index];
      return !!authorized && has(authorized.answer, gold.current) && inputFor(`live:${index}`).length > 0
        && safe(active(authorized)) && retained(active(authorized));
    }) },
    { name: 'read_copies_expire_and_restart_is_safe', passed: detail.filter(row => row.index > gold.authorizedIndex).length > 0
      && detail.every(row => row.inputPresent && row.inputsSafe && row.answerSafe && row.stateSafe && row.keepersPresent)
      && finalInputs.length > 0 && safe(finalInputs) && safe(data.result.answer) && safe(active(data.learning))
      && retained(data.result.answer) && retained(active(data.learning)) },
  ];
  return { validatorVersion: 3, reliability, passed: reliability.passed && checks.every(row => row.passed), checks, ordinary: detail,
    final: { inputPresent: finalInputs.length > 0, inputsSafe: safe(finalInputs), answerSafe: safe(data.result.answer), stateSafe: safe(active(data.learning)), keepersPresent: retained(data.result.answer) },
    worlds: 1, checkpoints: 4 };
}
export function scoreEpisode(gold: EpisodeGold, capture: string) {
  const read = (file: string) => JSON.parse(readFileSync(join(capture, file), 'utf8'));
  const inputDir = join(capture, 'model-inputs');
  return evaluateEpisode(gold, { initial: read('initial-learning.json'), live: read('live-control.json'),
    learning: read('learning.json'), result: read('result.json'),
    inputs: existsSync(inputDir) ? readdirSync(inputDir).filter(file => file.endsWith('.json')).map(file => read('model-inputs/'+file)) : [] });
}
