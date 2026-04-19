import type { MessageBundle } from '@/i18n/messages';

export type CronTemplateCopy = {
  title: string;
  description: string;
  prompt: string;
};

export function getCronTemplateCopy(
  cron: MessageBundle['cron'],
  templateId: string,
): CronTemplateCopy | undefined {
  const raw = cron.templates;
  if (!raw || typeof raw !== 'object') return undefined;
  const row = (raw as Record<string, { title?: string; description?: string; prompt?: string } | undefined>)[
    templateId
  ];
  if (!row || typeof row !== 'object') return undefined;
  const title = row.title?.trim();
  const prompt = row.prompt?.trim();
  if (!title || !prompt) return undefined;
  return {
    title,
    description: (row.description ?? '').trim(),
    prompt,
  };
}
