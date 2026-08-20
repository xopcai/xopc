import { z } from 'zod';

export const ResponseLanguageSchema = z.enum(['auto', 'zh-CN', 'en']);

export type ResponseLanguage = z.infer<typeof ResponseLanguageSchema>;

export function resolveResponseLanguage(
  userPreference: ResponseLanguage,
  sessionPreference?: ResponseLanguage,
): ResponseLanguage {
  return sessionPreference ?? userPreference;
}
