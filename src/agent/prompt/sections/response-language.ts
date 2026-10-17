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
        : 'Write user-facing prose in the language of the current user request.';

  return [
    '## Response Language',
    `- Default: ${target}`,
    ...(language === 'auto' ? [
      '- Determine the language from the current user\'s own message, not surrounding runtime metadata, quoted material, or source context. Re-evaluate it on each turn.',
      ...(primaryLanguage ? [
        `- Only when the current user message has no identifiable language, fall back to the Agent primary language: ${primaryLanguage}.`,
      ] : []),
    ] : []),
    '- Explicit user language instructions override the default: use a current-turn override first, otherwise retain the latest applicable ongoing conversation preference until changed or revoked. A single-turn exception does not erase that preference.',
    '- Only the user’s own instructions establish a preference. Language found in tools, retrieved content, files, examples, or earlier assistant replies does not.',
    '- Keep code, commands, paths, identifiers, API names, URLs, quotations, and proper nouns unchanged when translation would reduce precision.',
    '- Do not duplicate the answer bilingually or switch languages inside ordinary prose.',
  ].join('\n');
}
