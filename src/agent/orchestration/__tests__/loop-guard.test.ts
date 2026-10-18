import { describe, expect, it } from 'vitest';
import { detectToolLoops, type RecentToolCall } from '../loop-guard.js';

const call = (revision = 'a', resultPreview = 'same'): RecentToolCall => ({ name: 'exec_command', params: { cmd: 'pnpm test' }, revision, resultPreview });
describe('loop guard', () => {
  it('warns about repeated failures but keeps tools available for repair', () => {
    expect(detectToolLoops([call(), call(), call()]).injection).toContain('3 identical');
  });
  it('does not carry an old stalled group across progress', () => {
    expect(detectToolLoops([call(), call(), call('b')]).injection).toBeNull();
    expect(detectToolLoops([call(), call(), call('a', 'different')]).injection).toBeNull();
  });
  it('compares complete arguments and output instead of a shared prefix', () => {
    expect(detectToolLoops([call('a', 'x'.repeat(500) + 'a'), call('a', 'x'.repeat(500) + 'b')]).injection).toBeNull();
  });
  it('ignores receipt paths and timing but preserves substantive output', () => {
    expect(detectToolLoops([call('a', 'pass\nℹ duration_ms 12.5\nLog: /tmp/one.log'),
      call('a', 'pass\nℹ duration_ms 31.7\nLog: /tmp/two.log')]).injection).toContain('2 identical');
    expect(detectToolLoops([call('a', 'pass\nLog: /tmp/one.log'), call('a', 'fail\nLog: /tmp/two.log')]).injection).toBeNull();
  });
  it('detects a stalled two-call cycle without treating an edit as a duplicate', () => {
    expect(detectToolLoops([call('a'), {name:'review_workspace',params:{},revision:'a'},
      call('a'), {name:'review_workspace',params:{},revision:'a'}]).injection).toContain('repeated cycle');
    expect(detectToolLoops([call('a'), call('b')]).injection).toBeNull();
  });
  it('warns about a repeated three-call cycle', () => {
    expect(detectToolLoops([call('a'), call('b'), call('c'), call('a'), call('b'), call('c')]).injection).toContain('repeated cycle');
  });
});
