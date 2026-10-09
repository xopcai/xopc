import { describe, expect, it } from 'vitest';

import { isExplicitFollowUp, parseLocalCheckTime, requestedCheckTime } from '../proactivity/follow-up-request.js';

const request = '我们继续讨论 personal agent 的主动联系方案。明天下午再检查一下，如果有值得补充的建议，主动在这里告诉我。';

describe('Personal follow-up requests', () => {
  it('recognizes a conditional request for useful proactive follow-up', () => {
    expect(isExplicitFollowUp(request)).toBe(true);
    expect(isExplicitFollowUp('Check back tomorrow and tell me if there is something useful.')).toBe(true);
  });
  it.each(['不要提醒我', '不用跟进这个话题', '别主动告诉我', '如果用户要求你明天跟进，你会怎么做？', 'Do not follow up tomorrow', '我们讨论一下主动联系方案'])('does not authorize %s', text => {
    expect(isExplicitFollowUp(text)).toBe(false);
  });
  it('uses the user timezone for tomorrow afternoon', () => {
    const observedAt = Date.parse('2026-10-09T19:38:00+08:00');
    expect(requestedCheckTime(request, observedAt, 'Asia/Shanghai')).toBe(Date.parse('2026-10-10T15:00:00+08:00'));
    expect(requestedCheckTime('明天下午3点半再检查', observedAt, 'Asia/Shanghai')).toBe(Date.parse('2026-10-10T15:30:00+08:00'));
  });
  it('uses calendar days across daylight saving changes', () => {
    expect(requestedCheckTime(request, Date.parse('2026-10-31T19:38:00-04:00'), 'America/New_York'))
      .toBe(Date.parse('2026-11-01T15:00:00-05:00'));
  });
  it('parses local dates without model epoch arithmetic and rejects nonexistent times', () => {
    expect(parseLocalCheckTime('2026-10-10T15:00', 'Asia/Shanghai')).toBe(Date.parse('2026-10-10T15:00:00+08:00'));
    expect(() => parseLocalCheckTime('2026-03-08T02:30', 'America/New_York')).toThrow('Invalid local');
    expect(() => parseLocalCheckTime('2026-10-10T15:00Z', 'Asia/Shanghai')).toThrow('nextCheckLocal');
    expect(() => parseLocalCheckTime('2026-02-30T15:00', 'Asia/Shanghai')).toThrow('Invalid local');
  });
});
