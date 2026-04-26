export function formatEnvelopeTimestamp(timezone?: string, now: Date = new Date()): string {
  try {
    const resolvedTimezone =
      timezone?.trim() || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: resolvedTimezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZoneName: 'short',
    }).formatToParts(now);

    const map: Record<string, string> = {};
    for (const part of parts) {
      if (part.type !== 'literal') {
        map[part.type] = part.value;
      }
    }

    const year = map.year ?? '';
    const month = map.month ?? '';
    const day = map.day ?? '';
    const hour = map.hour ?? '';
    const minute = map.minute ?? '';
    const tzName = map.timeZoneName ?? '';

    if (!year || !month || !day || !hour || !minute) {
      return `${now.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
    }

    return `${year}-${month}-${day} ${hour}:${minute}${tzName ? ` ${tzName}` : ''}`;
  } catch {
    return `${now.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
  }
}

export function prependEnvelopeTimestamp(content: string, timezone?: string): string {
  const text = content.trim();
  if (!text) {
    return content;
  }
  const timestamp = formatEnvelopeTimestamp(timezone);
  return `[${timestamp}] ${content}`;
}

/** Matches `[YYYY-MM-DD HH:MM]` plus optional ` TZ` inside brackets, as produced by {@link prependEnvelopeTimestamp}. */
const ENVELOPE_TIMESTAMP_PREFIX_RE =
  /^\[\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(?:\s+[^\]]+)?\]\s*/;

/**
 * Remove a single leading envelope timestamp prefix from inbound text (session auto-title, etc.).
 * Does not strip arbitrary `[…]` — only the date+time-shaped prefix from {@link formatEnvelopeTimestamp}.
 */
export function stripEnvelopeTimestampPrefix(text: string): string {
  return text.replace(ENVELOPE_TIMESTAMP_PREFIX_RE, '');
}

