/** Resolves a local-hour quiet window on the UTC timeline, including DST gaps and repeated hours. */
export function notificationQuietUntil(input: { timezone: string; quietStartHour: number; quietEndHour: number }, now: number): number | null {
  if (!Number.isSafeInteger(now) || now < 0 || ![input.quietStartHour, input.quietEndHour].every((hour) => Number.isInteger(hour) && hour >= 0 && hour < 24)) {
    throw new Error('Invalid quiet hours');
  }
  if (input.quietStartHour === input.quietEndHour) return null;
  const formatter = new Intl.DateTimeFormat('en', { timeZone: input.timezone, hour: '2-digit', hourCycle: 'h23' });
  const quiet = (at: number) => {
    const hour = Number(formatter.format(at));
    return input.quietStartHour < input.quietEndHour
      ? hour >= input.quietStartHour && hour < input.quietEndHour
      : hour >= input.quietStartHour || hour < input.quietEndHour;
  };
  if (!quiet(now)) return null;
  for (let minute = 1; minute <= 2880; minute++) {
    const candidate = Math.floor(now / 60_000) * 60_000 + minute * 60_000;
    if (!quiet(candidate)) return candidate;
  }
  throw new Error('Quiet hours did not resolve within two days');
}
