function padDatePart(value: number): string {
  return String(value).padStart(2, '0');
}

export function toDatePickerValue(date: Date): string {
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`;
}

export function parseDatePickerValue(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(year, month, day, 12);
  return date.getFullYear() === year && date.getMonth() === month && date.getDate() === day
    ? date
    : null;
}

export function displayDatePickerValue(value: string, language: 'en' | 'zh'): string {
  const date = parseDatePickerValue(value);
  if (!date) return '';
  if (language === 'zh') {
    return `${date.getFullYear()}/${padDatePart(date.getMonth() + 1)}/${padDatePart(date.getDate())}`;
  }
  return new Intl.DateTimeFormat('en', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date);
}
