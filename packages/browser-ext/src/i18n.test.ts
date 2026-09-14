import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  extensionLocale,
  loadExtensionLocalePreference,
  saveExtensionLocalePreference,
  t,
} from './i18n';

afterEach(() => vi.unstubAllGlobals());

describe('extension i18n', () => {
  it('reads localized messages and forwards substitutions', () => {
    const getMessage = vi.fn().mockReturnValue('最多可附加 5 个文件');
    vi.stubGlobal('chrome', { i18n: { getMessage, getUILanguage: () => 'zh_CN' } });

    expect(t('errorAttachmentLimit', '5')).toBe('最多可附加 5 个文件');
    expect(getMessage).toHaveBeenCalledWith('errorAttachmentLimit', '5');
    expect(extensionLocale()).toBe('zh-CN');
  });

  it('returns the key when Chrome cannot resolve a message', () => {
    vi.stubGlobal('chrome', { i18n: { getMessage: () => '', getUILanguage: () => 'en' } });

    expect(t('missingMessage')).toBe('missingMessage');
  });

  it('loads and persists a user-selected runtime locale', async () => {
    const get = vi.fn(async () => ({ 'xopc.sidepanel.locale': 'zh-CN' }));
    const set = vi.fn(async () => undefined);
    vi.stubGlobal('chrome', {
      i18n: { getMessage: (key: string) => key === '@@bidi_dir' ? 'ltr' : '', getUILanguage: () => 'en' },
      runtime: { getURL: (path: string) => `chrome-extension://test/${path}` },
      storage: { local: { get, set } },
    });
    vi.stubGlobal('document', {
      documentElement: { lang: '', dir: '' },
      title: '',
    });
    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      json: async () => url.includes('zh_CN')
        ? {
            appName: { message: 'xopc' },
            errorAttachmentLimit: {
              message: '最多可附加 $COUNT$ 个文件',
              placeholders: { count: { content: '$1' } },
            },
          }
        : { appName: { message: 'xopc' }, settings: { message: 'Settings' } },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(loadExtensionLocalePreference()).resolves.toBe('zh-CN');
    expect(extensionLocale()).toBe('zh-CN');
    expect(t('errorAttachmentLimit', '3')).toBe('最多可附加 3 个文件');

    await saveExtensionLocalePreference('en');
    expect(set).toHaveBeenCalledWith({ 'xopc.sidepanel.locale': 'en' });
    expect(t('settings')).toBe('Settings');
  });
});
