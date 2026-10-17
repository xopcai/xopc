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

  it('detects English sentences even when they contain a Chinese proper noun', () => {
    expect(hasUnlocalizedTaskText([
      "The response provides clear textual steps for locating and entering the 'West Bund Life' (西岸生活) WeChat mini-program if a direct link is not available.",
    ], 'zh')).toBe(true);
    expect(hasUnlocalizedTaskText([
      '购票说明包含 West Bund Museum 官方网站，以及 West Bund Life 小程序的入口。',
    ], 'zh')).toBe(false);
    expect(hasUnlocalizedTaskText(['The New York Times 报道中标注的来源和日期均已核对。'], 'zh')).toBe(false);
  });
});
