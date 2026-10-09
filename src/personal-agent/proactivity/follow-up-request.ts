import { DateTime } from 'luxon';

/** Recognize user requests, excluding negated and hypothetical follow-ups. */
export function isExplicitFollowUp(text: string): boolean {
  return text.split(/[。！？!?\n;]/u).some(clause => {
    if (/(?:不要|不用|不需要|别|无需|不能|无法).*(?:提醒|跟进|关注|检查|主动|联系|告诉)|(?:don't|do not|no need|cannot|can't).*(?:remind|follow|watch|check|contact)|(?:如果|假如).*(?:我|用户).*(?:要求|说)|(?:if|suppose).*\b(?:ask|request|say)\b/iu.test(clause)) return false;
    return /提醒我|跟进|帮我.*关注|继续关注|(?:主动|到时候|届时).*(?:告诉我|联系我|通知我)|(?:明天|后天|下周|稍后|晚点|之后).*(?:再|继续).*(?:检查|看看|讨论)|remind me|follow[ -]up|keep (?:an eye|watch)|(?:check (?:again|back)|(?:contact|tell|notify|message) me).*(?:tomorrow|later|next)/iu.test(clause);
  });
}

/** Resolve common relative periods from the user's statement, avoiding model epoch arithmetic. */
export function requestedCheckTime(text: string, observedAt: number, timezone: string): number | undefined {
  const match = /(?:明天|后天)(上午|下午|晚上|中午)(?:\s*([0-9]{1,2})(?:[:：]([0-9]{2})|点(?:([0-9]{1,2})分|半)?))?/u.exec(text);
  if (!match) return undefined;
  const period = match[1];
  let hour = match[2] === undefined ? ({ 上午: 9, 下午: 15, 晚上: 19, 中午: 12 }[period]!) : Number(match[2]);
  if (['下午', '晚上', '中午'].includes(period) && hour < 12) hour += 12;
  const minute = Number(match[3] ?? match[4] ?? (match[0].endsWith('半') ? 30 : 0));
  if (hour > 23 || minute > 59) throw new Error('Invalid requested follow-up time');
  const date = DateTime.fromMillis(observedAt, { zone: timezone }).plus({ days: match[0].startsWith('后天') ? 2 : 1 })
    .set({ hour, minute, second: 0, millisecond: 0 });
  if (!date.isValid || date.hour !== hour || date.minute !== minute) throw new Error('Requested follow-up time does not exist in this timezone');
  return date.toMillis();
}

export function parseLocalCheckTime(value: string, timezone: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/u.test(value)) throw new Error('nextCheckLocal must be YYYY-MM-DDTHH:mm in the configured timezone');
  const date = DateTime.fromISO(value, { zone: timezone });
  if (!date.isValid || date.toFormat("yyyy-MM-dd'T'HH:mm") !== value.slice(0, 16)) throw new Error('Invalid local follow-up time');
  return date.toMillis();
}
