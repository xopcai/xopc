import { Type } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';

const SessionStatusSchema = Type.Object({
  timezone: Type.Optional(
    Type.String({
      description:
        'Optional IANA timezone for formatting (e.g. Asia/Shanghai). When omitted, uses the host/browser default timezone.',
    }),
  ),
});

function formatTimestamp(now: Date, timezone?: string): { label: string; isoUtc: string; tz: string } {
  const isoUtc = now.toISOString();
  const fallbackTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const tz = (timezone ?? '').trim() || fallbackTz;
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
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
    const second = map.second ?? '';
    const tzName = map.timeZoneName ?? '';

    const ok = year && month && day && hour && minute && second;
    const label = ok
      ? `${year}-${month}-${day} ${hour}:${minute}:${second}${tzName ? ` ${tzName}` : ''}`
      : `${isoUtc.slice(0, 19).replace('T', ' ')} UTC`;
    return { label, isoUtc, tz };
  } catch {
    return { label: `${isoUtc.slice(0, 19).replace('T', ' ')} UTC`, isoUtc, tz };
  }
}

export function createSessionStatusTool(): AgentTool {
  return {
    name: 'session_status',
    label: '📊 Session Status',
    description:
      'Show a compact status card including the current timestamp (UTC + formatted local time). Useful when you need the current date/time without relying on the system prompt.',
    parameters: SessionStatusSchema,
    async execute(
      _toolCallId: string,
      params: any,
      _signal?: AbortSignal,
    ): Promise<AgentToolResult<{}>> {
      const now = new Date();
      const fmt = formatTimestamp(now, (params as { timezone?: string }).timezone);
      const lines = [
        '📊 Session status',
        `Time: ${fmt.label}`,
        `Time zone: ${fmt.tz}`,
        `UTC: ${fmt.isoUtc}`,
        `timestampMs: ${now.getTime()}`,
      ];
      return {
        content: [{ type: 'text', text: lines.join('\n') }],
        details: {},
      };
    },
  } as any;
}

