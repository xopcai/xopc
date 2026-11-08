import { describe, expect, it } from 'vitest';
import { recallAnswerCorrection, recallCitationIds } from '../recall-grounding.js';
const prompt = 'On-demand recall: completed\n[H1] recordedAt=2026-11-08 conversationId=id entryId=entry seq=1 owner said: "旧release不再使用。更改原因是新保护规则只覆盖stable分支。"';
describe('recall provenance checks', () => {
  it('accepts a real citation and a verbatim excerpt with harmless spacing', () => {
    expect(recallAnswerCorrection(prompt, '原话是“新保护规则只覆盖 stable 分支”[H1]。')).toBeUndefined();
  });
  it('rejects invented source IDs and rearranged text presented as an exact quote', () => {
    expect(recallAnswerCorrection(prompt, '见[H9]。')).toContain('Unknown citation H9');
    expect(recallAnswerCorrection(prompt, '原话是“更改原因是新保护规则只覆盖stable分支；旧release不再使用”[H1]。')).toContain('not a verbatim excerpt');
  });
  it('allows honest paraphrases and does not interpret ordinary H-like text as citations', () => {
    expect(recallAnswerCorrection(prompt, '因为保护规则，改为stable[H1]。')).toBeUndefined();
    expect(recallAnswerCorrection('ordinary system prompt', '请打印[H9]。')).toBeUndefined();
  });
  it('checks inline and grouped citation forms without mistaking quoted values for IDs', () => {
    expect(recallCitationIds('来源[H1：“新保护规则只覆盖stable分支”]，[H1, H2]')).toEqual(['H1', 'H1', 'H2']);
    expect(recallAnswerCorrection(prompt, '来源[H1：“新保护规则只覆盖stable分支”]')).toBeUndefined();
    expect(recallAnswerCorrection(prompt, '来源[H9：“虚构出来的引用内容”]')).toContain('Unknown citation H9');
    expect(recallAnswerCorrection(prompt, '来源[H1：“旧release停用因为不兼容”]')).toContain('not a verbatim excerpt');
    expect(recallAnswerCorrection(prompt, '“旧release停用因为不兼容”[H1, H1]')).toContain('not a verbatim excerpt');
  });

  it('requires citations for historical factual answers while allowing honest abstention and quiet current facts', () => {
    const historical = prompt.replace('completed', 'completed; reason=historical_question');
    expect(recallAnswerCorrection(historical, '后来改用了stable。')).toContain('missing a source citation');
    expect(recallAnswerCorrection(historical, '没有关于数据库更换的记录，无法确认原因。')).toBeUndefined();
    expect(recallAnswerCorrection(prompt, '当前使用stable。')).toBeUndefined();
  });

  it('rejects H citations when recall did not return supporting excerpts', () => {
    expect(recallAnswerCorrection('On-demand recall: empty', '这条规则见[H1]。')).toContain('Unknown citation H1');
  });
});
