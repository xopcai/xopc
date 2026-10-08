import { z } from 'zod';

export const PersonalRequestResultSchema = z.object({
  summary: z.string().trim().min(1).max(8000),
  coverage: z.object({
    from: z.string().datetime({ offset: true }), to: z.string().datetime({ offset: true }),
    scannedCount: z.number().int().nonnegative(), partial: z.boolean(),
  }).optional(),
  items: z.array(z.object({
    messageId: z.string().min(1).max(500), subject: z.string().max(500), sender: z.string().max(500),
    receivedAt: z.string().datetime({ offset: true }), importanceReason: z.string().max(2000),
    suggestedAction: z.string().max(2000).optional(),
    openUrl: z.string().url().refine(value => {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password
        && ['mail.google.com', 'outlook.live.com', 'outlook.office.com', 'outlook.office365.com'].includes(url.hostname);
    }).optional(),
  })).max(50).default([]),
}).strict();
export type PersonalRequestResult = z.infer<typeof PersonalRequestResultSchema>;

function escapeMarkdown(value: string): string {
  return value.replace(/[\\`*_{}\[\]()<>#!|]/g, '\\$&').replace(/\r?\n/g, ' ');
}
export function renderPersonalRequestResult(result: PersonalRequestResult): string {
  const lines = [result.summary];
  if (result.coverage) {
    const { from, to, scannedCount, partial } = result.coverage;
    lines.push(`查询范围：${escapeMarkdown(from)} — ${escapeMarkdown(to)}；已检查 ${scannedCount} 封邮件${partial ? '。查询尚未覆盖全部邮件。' : '。'}`);
  }
  for (const item of result.items) {
    const title = escapeMarkdown(item.subject || '(无主题)');
    lines.push(`${item.openUrl ? `[${title}](${encodeURI(item.openUrl).replace(/\(/g, '%28').replace(/\)/g, '%29')})` : title}\n\n`
      + `${escapeMarkdown(item.sender)} · ${escapeMarkdown(item.receivedAt)}\n\n`
      + `${escapeMarkdown(item.importanceReason)}${item.suggestedAction ? `\n\n${escapeMarkdown(item.suggestedAction)}` : ''}`);
  }
  return lines.join('\n\n');
}
