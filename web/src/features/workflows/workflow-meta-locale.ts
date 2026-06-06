import type { StoredLanguage } from '@/lib/storage';

import type { WorkflowDefinition, WorkflowDefinitionExamplePrompt } from './workflow-api';

export type WorkflowLocaleCode = 'en' | 'zh';

export function normalizeWorkflowLocale(language: StoredLanguage | undefined): WorkflowLocaleCode {
  return language === 'zh' ? 'zh' : 'en';
}

export interface WorkflowLocalizedCopy {
  description: string;
  whenToUse?: string;
  examplePrompts: WorkflowDefinitionExamplePrompt[];
}

export function resolveWorkflowLocalizedCopy(
  definition: WorkflowDefinition,
  language: StoredLanguage | undefined,
): WorkflowLocalizedCopy {
  const locale = normalizeWorkflowLocale(language);
  const bundle = locale !== 'en' ? definition.metadata.i18n?.[locale] : undefined;
  const examplePrompts =
    bundle?.examplePrompts && bundle.examplePrompts.length > 0
      ? bundle.examplePrompts
      : (definition.metadata.examplePrompts ?? []);
  return {
    description: pickNonEmpty(bundle?.description, definition.description),
    whenToUse: pickOptional(bundle?.whenToUse, definition.metadata.whenToUse),
    examplePrompts,
  };
}

export function collectWorkflowSearchText(definition: WorkflowDefinition): string {
  const parts = [
    definition.name,
    definition.title,
    definition.description,
    definition.metadata.whenToUse ?? '',
    ...(definition.metadata.examplePrompts ?? []).map((item) => item.text),
    ...Object.values(definition.metadata.i18n ?? {}).flatMap((bundle) => [
      bundle.description ?? '',
      bundle.whenToUse ?? '',
      ...(bundle.examplePrompts ?? []).map((item) => item.text),
    ]),
    ...definition.metadata.tags,
  ];
  return parts.join(' ').toLowerCase();
}

function pickNonEmpty(localized: string | undefined, fallback: string): string {
  const trimmed = localized?.trim();
  return trimmed ? trimmed : fallback;
}

function pickOptional(localized: string | undefined, fallback: string | undefined): string | undefined {
  const trimmed = localized?.trim();
  if (trimmed) return trimmed;
  const fb = fallback?.trim();
  return fb || undefined;
}

export function applyWorkflowExamplePrompt(
  example: WorkflowDefinitionExamplePrompt,
  setGoal: (value: string) => void,
  setArgValues: (updater: (prev: Record<string, string>) => Record<string, string>) => void,
): void {
  if (example.field === 'goal') {
    setGoal(example.text);
    return;
  }
  setArgValues((prev) => ({ ...prev, [example.field]: example.text }));
}
