export function formatNoteTimestamp(timestamp: number, locale: string): string {
  return new Date(timestamp).toLocaleString(locale, {
    year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
  });
}
