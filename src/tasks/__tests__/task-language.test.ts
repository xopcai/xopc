import { beforeEach, describe, expect, it, vi } from 'vitest';

const { profile } = vi.hoisted(() => ({ profile: { locale: 'en' } }));
vi.mock('../../user-model/profile.js', () => ({ getUserProfileSnapshot: () => profile }));
vi.mock('../../storage/sqlite/index.js', () => ({ isXopcDatabaseOpen: () => true }));

import { hasUnlocalizedTaskText, resolveTaskLocale } from '../task-language.js';

describe('task language', () => {
  beforeEach(() => { profile.locale = 'en'; });

  it('keeps a Chinese request Chinese despite an English profile default', () => {
    expect(resolveTaskLocale({ title: '查找官方购票入口' })).toBe('zh');
    expect(resolveTaskLocale({ title: 'Research', contract: { objective: '查找官方购票入口' } })).toBe('zh');
  });

  it('honors explicit task language and uses profile language for English project context', () => {
    expect(resolveTaskLocale({ title: '查找官方购票入口', locale: 'en' })).toBe('en');
    profile.locale = 'zh-CN';
    expect(resolveTaskLocale({ title: 'Research West Bund Museum' })).toBe('zh');
  });

  it('detects English prose while preserving technical references and bilingual proper nouns', () => {
    expect(hasUnlocalizedTaskText(['The response contains official clickable ticketing URLs.'], 'zh')).toBe(true);
    expect(hasUnlocalizedTaskText(['说明包含 West Bund Museum 的官方购票链接。'], 'zh')).toBe(false);
    expect(hasUnlocalizedTaskText(['report.md', 'https://www.wbmshanghai.com/tickets'], 'zh')).toBe(false);
    expect(hasUnlocalizedTaskText(['The response contains official clickable ticketing URLs.'], 'en')).toBe(false);
  });
});
