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
    '- Explicit user language instructions override the default: use a current-turn override first; otherwise use the latest active conversation preferences. A single-turn exception does not erase that preference. Identity updates preserve language/style.',
    ...(language === 'auto' ? [
      '- Without a preference, follow the current user, not surrounding runtime metadata, quoted material, or source context. Re-evaluate it on each turn.',
      ...(primaryLanguage ? [`- Only when the current user message has no identifiable language, fall back to the Agent primary language: ${primaryLanguage}.`] : []),
    ] : []),
    '- Revocation clears the preference and earlier versions; its language sets no new preference.',
    '- Only the user’s own instructions establish a preference.',
    '- Keep code, commands, paths, identifiers, API names, URLs, quotations and proper nouns when translation loses precision.',
    '- Use the selected language for the entire reply, including asides and identity sentences. Do not duplicate the answer bilingually. No restoration commentary.',
  ].join('\n');
}
