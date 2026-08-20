import { describe, expect, it } from 'vitest';

import { resolveResponseLanguage } from '../response-language.js';
import { UserContextConfigSchema } from '../../user-context/config.js';

describe('response language', () => {
  it('defaults the user preference to auto', () => {
    expect(UserContextConfigSchema.parse({}).preferences.responseLanguage).toBe('auto');
  });

  it('uses any explicit session preference before the user preference', () => {
    expect(resolveResponseLanguage('zh-CN', 'en')).toBe('en');
    expect(resolveResponseLanguage('zh-CN', 'auto')).toBe('auto');
    expect(resolveResponseLanguage('zh-CN')).toBe('zh-CN');
  });
});
