import type { ResponseLanguage } from './response-language.js';

export type ObservedResponseLanguage = 'zh-CN' | 'en' | 'mixed' | 'neutral';

export interface ResponseLanguageAnalysis {
  expected: ResponseLanguage;
  observed: ObservedResponseLanguage;
  compliant: boolean;
  hanCharacters: number;
  latinWords: number;
}

function proseOnly(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]+`/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\]\([^)]*\)/g, ']')
    .replace(/<[^>]+>/g, ' ');
}

function isProseWord(word: string): boolean {
  if (word.length < 2 || word === word.toUpperCase()) return false;
  return !/[A-Z]/.test(word.slice(1));
}

export function analyzeResponseLanguage(
  text: string,
  expected: ResponseLanguage,
): ResponseLanguageAnalysis {
  const prose = proseOnly(text);
  const hanCharacters = prose.match(/\p{Script=Han}/gu)?.length ?? 0;
  const latinWords = (prose.match(/\p{Script=Latin}[\p{Script=Latin}'’-]*/gu) ?? [])
    .filter(isProseWord).length;
  const hasChinese = hanCharacters >= 10;
  const hasEnglish = latinWords >= 8;

  let observed: ObservedResponseLanguage;
  if (!hasChinese && !hasEnglish) {
    observed = 'neutral';
  } else if (!hasEnglish) {
    observed = 'zh-CN';
  } else if (!hasChinese) {
    observed = 'en';
  } else {
    const chineseWordEstimate = hanCharacters / 2;
    if (chineseWordEstimate >= latinWords * 1.8) {
      observed = 'zh-CN';
    } else if (latinWords >= chineseWordEstimate * 1.8) {
      observed = 'en';
    } else {
      observed = 'mixed';
    }
  }

  const compliant =
    observed === 'neutral' ||
    (expected === 'auto' ? observed !== 'mixed' : observed === expected);

  return { expected, observed, compliant, hanCharacters, latinWords };
}
