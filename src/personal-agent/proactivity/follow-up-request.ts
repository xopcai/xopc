import { DateTime } from 'luxon';
import type { PersonalOneShotDestination } from '@xopcai/gateway-contract';

const QUOTED_EXAMPLE_RE = /(?:比如|例如|譬如|举例|示例|引用|像.*说|for example|e\.g\.|such as)[^。！？!?\n;]*?(?:「[^」]*」|『[^』]*』|“[^”]*”|"[^"]*"|'[^']*')/giu;
const NEGATION_RE = /(?:不要|不用|不需要|别|无需|不能|无法|先别|并非|不是).*(?:提醒|跟进|关注|检查|主动|联系|告诉|通知|盯|放工作台)|(?:don't|do not|no need|never|cannot|can't).*(?:remind|follow|watch|check|contact|notify|tell|alert)/iu;
const HYPOTHETICAL_RE = /(?:如果|假如|假设|要是)\s*(?:我|用户|有人).*(?:要求|说|让你|叫你)|(?:if|suppose|assuming|what if)\s+(?:i|the user|someone)\b.*\b(?:ask|asked|request|say|said|tell)\b/iu;

function actionableClauses(text: string): string[] {
  const stripped = text.replace(QUOTED_EXAMPLE_RE, ' ');
  return stripped
    .split(/[。！？!?\n;；]/u)
    .map(clause => clause.trim())
    .filter(clause => Boolean(clause) && !NEGATION_RE.test(clause) && !HYPOTHETICAL_RE.test(clause));
}

/** Recognize user requests, excluding negated, quoted-example, and hypothetical follow-ups. */
export function isExplicitFollowUp(text: string): boolean {
  return actionableClauses(text).some(clause =>
    /提醒我|跟进|帮我.*关注|继续关注|(?:主动|到时候|届时).*(?:告诉我|联系我|通知我)|(?:如果|要是|若).*(?:告诉|通知|提醒|放工作台|在工作台)|(?:还|仍|没|未).*(?:需要|待|缺|定|处理|确认|审批).*(?:告诉|通知|提醒|说一声|放工作台)|(?:明天|后天|下周|稍后|晚点|之后).*(?:再|继续).*(?:检查|看看|讨论)|remind me|follow[ -]up|keep (?:an eye|watch)|(?:check (?:again|back)|(?:contact|tell|notify|message) me).*(?:tomorrow|later|next|if|still)/iu.test(clause),
  );
}

/** Recognize an explicit one-shot conditional delegation on a verifiable pending item. */
export function isExplicitOneShotFollowUp(text: string): boolean {
  return actionableClauses(text).some(clause =>
    /(?:如果|要是|若|倘若).*(?:告诉|通知|提醒|说一声|叫我|知会|放工作台|在工作台)|(?:还|仍|没|未).*(?:需要|待|缺|定|确认|处理|审批|补|齐).*(?:告诉|通知|提醒|说一声|叫我|放工作台|在工作台)|(?:放工作台|在工作台).*(?:提醒|提示|通知)|(?:\b(?:if|unless)\b.*\b(?:remind|tell|notify|message|let me know|alert)\b|\b(?:remind me|let me know|notify me|alert me)\b.*\b(?:if|still)\b)/iu.test(clause),
  );
}

/** Recognize an explicit user instruction to stop an active follow-up, excluding negations and quotes. */
export function isExplicitStopFollowUp(text: string): boolean {
  const stripped = text.replace(QUOTED_EXAMPLE_RE, ' ');
  return stripped
    .split(/[。！？!?\n;；]/u)
    .map(clause => clause.trim())
    .some(clause => {
      if (!clause || HYPOTHETICAL_RE.test(clause)) return false;
      if (/(?:先别|不要|别|不是)\s*(?:停止|结束|取消)/iu.test(clause)) return false;
      return /停止.*(?:跟进|关注|提醒)?|结束.*(?:跟进|关注|提醒)|取消.*(?:提醒|跟进)|(?:这件|这个|那件|它)?\s*(?:不用|不需要|别再?)\s*(?:盯|关注|跟进|提醒|看)了?|stop(?:\s+following|\s+this\s+follow[- ]?up|\s+reminding)?|don't\s+(?:remind|follow)|no\s+need\s+to\s+(?:follow|remind|watch)/iu.test(clause);
    });
}

export function parseOneShotDestination(text: string): PersonalOneShotDestination | undefined {
  for (const clause of actionableClauses(text)) {
    if (/放(?:在|到)?工作台|在工作台(?:里|上)?(?:提醒|提示|通知|标出|点亮)?|工作台(?:提醒|未读|提示)|只(?:提醒|点亮|放)工作台|\b(?:in|to|on)\s+(?:the\s+)?workbench\b|\bworkbench\s+(?:only|alert|reminder)\b/iu.test(clause)) {
      return 'workbench';
    }
    if (/在这里(?:告诉|提醒|通知)|在对话里(?:告诉|提醒)|发消息(?:告诉|提醒)|告诉我(?:一声)?|\b(?:in\s+this\s+chat|message\s+me|tell\s+me\s+here)\b/iu.test(clause)) {
      return 'personal';
    }
  }
  return undefined;
}

const WEEKDAY_MAP: Record<string, number> = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7,
};

function resolveHourMinute(
  period: string | undefined,
  rawHour: string | undefined,
  rawColonMin?: string,
  rawCnMin?: string,
  half = false,
): { hour: number; minute: number } {
  const defaultHours: Record<string, number> = { 凌晨: 6, 早上: 8, 上午: 9, 中午: 12, 下午: 15, 傍晚: 18, 晚上: 19 };
  let hour = rawHour === undefined ? (period ? defaultHours[period] ?? 9 : 9) : Number(rawHour);
  if (period && ['下午', '傍晚', '晚上'].includes(period) && hour < 12) hour += 12;
  if (period === '中午' && hour < 11) hour += 12;
  const minute = Number(rawColonMin ?? rawCnMin ?? (half ? 30 : 0));
  if (hour > 23 || minute > 59) throw new Error('Invalid requested follow-up time');
  return { hour, minute };
}

/** Resolve common relative, weekday, or same-day times from the user's statement, avoiding model epoch arithmetic. */
export function requestedCheckTime(text: string, observedAt: number, timezone: string): number | undefined {
  const base = DateTime.fromMillis(observedAt, { zone: timezone });
  if (!base.isValid) throw new Error('Invalid timezone');

  const isoMatch = /\b(\d{4}-\d{2}-\d{2})[T\s]+([01]?\d|2[0-3]):([0-5]\d)\b/u.exec(text);
  if (isoMatch) {
    const dt = DateTime.fromObject({
      year: Number(isoMatch[1]!.slice(0, 4)),
      month: Number(isoMatch[1]!.slice(5, 7)),
      day: Number(isoMatch[1]!.slice(8, 10)),
      hour: Number(isoMatch[2]),
      minute: Number(isoMatch[3]),
      second: 0,
      millisecond: 0,
    }, { zone: timezone });
    if (!dt.isValid) throw new Error('Requested follow-up time does not exist in this timezone');
    return dt.toMillis();
  }

  const relMatch = /(今天|今日|明天|明日|后天)\s*(凌晨|早上|上午|中午|下午|傍晚|晚上)?(?:\s*([0-9]{1,2})(?:[:：]([0-9]{2})|点(?:([0-9]{1,2})分|(半))?))?/u.exec(text);
  if (relMatch && (relMatch[2] !== undefined || relMatch[3] !== undefined)) {
    const dayOffset = relMatch[1]!.startsWith('后') ? 2 : relMatch[1]!.startsWith('明') ? 1 : 0;
    const { hour, minute } = resolveHourMinute(relMatch[2], relMatch[3], relMatch[4], relMatch[5], Boolean(relMatch[6]));
    const date = base.plus({ days: dayOffset }).set({ hour, minute, second: 0, millisecond: 0 });
    if (!date.isValid || date.hour !== hour || date.minute !== minute) {
      throw new Error('Requested follow-up time does not exist in this timezone');
    }
    return date.toMillis();
  }

  const weekMatch = /(本|这|下)?(?:周|星期|礼拜)([一二三四五六日天])\s*(凌晨|早上|上午|中午|下午|傍晚|晚上)?\s*([0-9]{1,2})(?:[:：]([0-9]{2})|点(?:([0-9]{1,2})分|(半))?)?/u.exec(text);
  if (weekMatch) {
    const prefix = weekMatch[1];
    const targetWeekday = WEEKDAY_MAP[weekMatch[2]!]!;
    const { hour, minute } = resolveHourMinute(weekMatch[3], weekMatch[4], weekMatch[5], weekMatch[6], Boolean(weekMatch[7]));
    let daysDelta = targetWeekday - base.weekday;
    if (prefix === '下') {
      daysDelta += 7;
    } else if (!prefix && daysDelta < 0) {
      daysDelta += 7;
    }
    let candidate = base.plus({ days: daysDelta }).set({ hour, minute, second: 0, millisecond: 0 });
    if (!prefix && daysDelta === 0 && candidate.toMillis() <= observedAt) {
      candidate = candidate.plus({ days: 7 });
    }
    if (!candidate.isValid || candidate.hour !== hour || candidate.minute !== minute) {
      throw new Error('Requested follow-up time does not exist in this timezone');
    }
    return candidate.toMillis();
  }

  // Same-day explicit clock time (exclude deadline-only phrases like "17:00 前/后结束").
  const clockRegex = /(凌晨|早上|上午|中午|下午|傍晚|晚上)?\s*([01]?[0-9]|2[0-3])[:：]([0-5][0-9])(?!\s*(?:前|之前|后|之后|截止|到期|结束|为止))/gu;
  const clockMatch = clockRegex.exec(text);
  if (clockMatch) {
    const { hour, minute } = resolveHourMinute(clockMatch[1], clockMatch[2], clockMatch[3]);
    const date = base.set({ hour, minute, second: 0, millisecond: 0 });
    if (!date.isValid || date.hour !== hour || date.minute !== minute) {
      throw new Error('Requested follow-up time does not exist in this timezone');
    }
    return date.toMillis();
  }

  return undefined;
}

/** Parse an explicit deadline/end-time mentioned in the utterance relative to checkAt's local day. */
export function requestedValidUntilTime(text: string, checkAt: number, timezone: string): number | undefined {
  const checkDate = DateTime.fromMillis(checkAt, { zone: timezone });
  if (!checkDate.isValid) return undefined;

  const patterns = [
    /(?:到|截至|截止到?)\s*(凌晨|早上|上午|中午|下午|傍晚|晚上)?\s*([01]?[0-9]|2[0-3])[:：]([0-5][0-9])/u,
    /(凌晨|早上|上午|中午|下午|傍晚|晚上)?\s*([01]?[0-9]|2[0-3])[:：]([0-5][0-9])\s*(?:前|之前|后[^，。！？\n]{0,8}结束|之后[^，。！？\n]{0,8}结束|截止|到期|结束|为止)/u,
    /\b(?:until|by|before)\s+([01]?[0-9]|2[0-3]):([0-5][0-9])\b/iu,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (!match) continue;
    const hasPeriod = match.length === 4;
    const { hour, minute } = hasPeriod
      ? resolveHourMinute(match[1], match[2], match[3])
      : resolveHourMinute(undefined, match[1], match[2]);
    const candidate = checkDate.set({ hour, minute, second: 0, millisecond: 0 });
    if (candidate.isValid && candidate.toMillis() > checkAt) {
      return candidate.toMillis();
    }
  }
  return undefined;
}

export function parseLocalCheckTime(value: string, timezone: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/u.test(value)) throw new Error('nextCheckLocal must be YYYY-MM-DDTHH:mm in the configured timezone');
  const date = DateTime.fromISO(value, { zone: timezone });
  if (!date.isValid || date.toFormat("yyyy-MM-dd'T'HH:mm") !== value.slice(0, 16)) throw new Error('Invalid local follow-up time');
  return date.toMillis();
}
