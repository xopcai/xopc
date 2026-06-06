import type { WorkflowMeta, WorkflowMetaExamplePrompt, WorkflowMetaLocale } from './types.js';

export type WorkflowLocaleCode = 'en' | 'zh';

export function normalizeWorkflowLocale(language: string | undefined): WorkflowLocaleCode {
  return language === 'zh' ? 'zh' : 'en';
}

export interface WorkflowLocalizedCopy {
  description: string;
  whenToUse?: string;
  examplePrompts: WorkflowMetaExamplePrompt[];
}

export function resolveWorkflowLocalizedCopy(
  meta: Pick<WorkflowMeta, 'description' | 'whenToUse' | 'examplePrompts' | 'i18n'>,
  locale: WorkflowLocaleCode,
): WorkflowLocalizedCopy {
  const bundle = locale !== 'en' ? meta.i18n?.[locale] : undefined;
  const examplePrompts =
    bundle?.examplePrompts && bundle.examplePrompts.length > 0
      ? bundle.examplePrompts
      : (meta.examplePrompts ?? []);
  return {
    description: pickNonEmpty(bundle?.description, meta.description),
    whenToUse: pickOptional(bundle?.whenToUse, meta.whenToUse),
    examplePrompts,
  };
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

export function validateExamplePrompts(value: unknown, path: string): WorkflowMetaExamplePrompt[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new Error(`${path} must be an array`);
  }
  const prompts: WorkflowMetaExamplePrompt[] = [];
  for (let index = 0; index < value.length; index++) {
    const item = value[index];
    if (!item || typeof item !== 'object') {
      throw new Error(`${path}[${index}] must be an object`);
    }
    const field = (item as WorkflowMetaExamplePrompt).field;
    const text = (item as WorkflowMetaExamplePrompt).text;
    if (typeof field !== 'string' || !field.trim()) {
      throw new Error(`${path}[${index}].field must be a non-empty string`);
    }
    if (typeof text !== 'string' || !text.trim()) {
      throw new Error(`${path}[${index}].text must be a non-empty string`);
    }
    prompts.push({ field: field.trim(), text: text.trim() });
  }
  return prompts;
}

export function validateMetaLocale(value: unknown, path: string): WorkflowMetaLocale {
  if (!value || typeof value !== 'object') {
    throw new Error(`${path} must be an object`);
  }
  const record = value as WorkflowMetaLocale;
  if (record.description !== undefined && (typeof record.description !== 'string' || !record.description.trim())) {
    throw new Error(`${path}.description must be a non-empty string`);
  }
  if (record.whenToUse !== undefined && typeof record.whenToUse !== 'string') {
    throw new Error(`${path}.whenToUse must be a string`);
  }
  validateExamplePrompts(record.examplePrompts, `${path}.examplePrompts`);
  return record;
}

export function validateMetaI18n(value: unknown): Record<string, WorkflowMetaLocale> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('meta.i18n must be an object');
  }
  const locales: Record<string, WorkflowMetaLocale> = {};
  for (const [locale, bundle] of Object.entries(value as Record<string, unknown>)) {
    if (!/^[a-z]{2}(-[A-Za-z]{2})?$/.test(locale)) {
      throw new Error(`meta.i18n key "${locale}" must be a language tag like "zh" or "en"`);
    }
    locales[locale] = validateMetaLocale(bundle, `meta.i18n.${locale}`);
  }
  return locales;
}
