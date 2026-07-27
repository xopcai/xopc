type LocaleBucket = 'default' | 'en' | 'zh';

function localeBucket(locale: string | undefined): LocaleBucket {
  if (!locale) return 'default';
  return locale.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

const mediumDateTimeFormatters: Record<LocaleBucket, Intl.DateTimeFormat> = {
  default: new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }),
  en: new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }),
  zh: new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }),
};

const mediumDateFormatters: Record<LocaleBucket, Intl.DateTimeFormat> = {
  default: new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }),
  en: new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }),
  zh: new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' }),
};

const shortMonthDateTimeFormatters: Record<LocaleBucket, Intl.DateTimeFormat> = {
  default: new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }),
  en: new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }),
  zh: new Intl.DateTimeFormat('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }),
};

const numericDateTimeFormatters: Record<LocaleBucket, Intl.DateTimeFormat> = {
  default: new Intl.DateTimeFormat(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }),
  en: new Intl.DateTimeFormat('en-US', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }),
  zh: new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }),
};

const relativeTimeFormatters: Record<
  Exclude<LocaleBucket, 'default'>,
  Intl.RelativeTimeFormat
> = {
  en: new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' }),
  zh: new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' }),
};

export function formatMediumDateTime(
  value: Date | number,
  locale?: string,
): string {
  return mediumDateTimeFormatters[localeBucket(locale)].format(value);
}

export function formatMediumDate(value: Date | number, locale?: string): string {
  return mediumDateFormatters[localeBucket(locale)].format(value);
}

export function formatShortMonthDateTime(
  value: Date | number,
  locale?: string,
): string {
  return shortMonthDateTimeFormatters[localeBucket(locale)].format(value);
}

export function formatNumericDateTime(
  value: Date | number,
  locale?: string,
): string {
  return numericDateTimeFormatters[localeBucket(locale)].format(value);
}

export function formatRelativeTime(
  value: number,
  unit: Intl.RelativeTimeFormatUnit,
  locale?: string,
): string {
  const bucket = localeBucket(locale);
  return relativeTimeFormatters[bucket === 'zh' ? 'zh' : 'en'].format(
    value,
    unit,
  );
}
