import { describe, expect, it } from 'vitest';

import { zh } from '../locales/zh';

function collectStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  if (value && typeof value === 'object') {
    return Object.values(value).flatMap(collectStrings);
  }
  return [];
}

describe('Chinese mobile copy', () => {
  it('uses plain-language labels for quick capture', () => {
    expect(zh.homePage.commandCapture).toBe('随手记');
    expect(zh.homePage.captureSaved).toBe('已保存到收件箱');
    expect(zh.inboxPage.capturePlaceholder).toBe('随手记点什么…');
  });

  it('does not expose literal Capture or Inbox translations', () => {
    const copy = collectStrings(zh).join('\n');
    expect(copy).not.toContain('捕获');
    expect(copy).not.toContain('Inbox');
  });
});
