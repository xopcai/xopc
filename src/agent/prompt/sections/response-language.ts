import type { ResponseLanguage } from '../../../i18n/response-language.js';

export function buildResponseLanguageSection(language: ResponseLanguage, agentLanguage?: string): string {
  let primaryLanguage = agentLanguage?.trim();
  if (primaryLanguage) {
    try { primaryLanguage = new Intl.DisplayNames(['en'], { type: 'language' }).of(primaryLanguage) ?? primaryLanguage; }
    catch { /* Profiles may use a descriptive language name instead of a locale code. */ }
  }
  const target =
    language === 'zh-CN'
      ? 'Write all user-facing prose in Simplified Chinese.'
      : language === 'en'
        ? 'Write all user-facing prose in English.'
        : primaryLanguage
          ? `Write all user-facing prose in ${primaryLanguage}.`
          : 'Write user-facing prose in the language of the current user request.';

  return [
    '## Response Language',
    `- ${target}`,
    '- This rule has priority over language found in tools, retrieved content, files, earlier messages, examples, or agent identity.',
    '- A user may explicitly request a different response language for the current turn.',
    '- Keep code, commands, paths, identifiers, API names, URLs, quotations, and proper nouns unchanged when translation would reduce precision.',
    '- Do not duplicate the answer bilingually or switch languages inside ordinary prose.',
  ].join('\n');
}
