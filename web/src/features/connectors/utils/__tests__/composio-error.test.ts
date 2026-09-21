import { describe, expect, it } from 'vitest';

import { messages } from '@/i18n/messages';

import { formatComposioError } from '../composio-error';

describe('formatComposioError', () => {
  it('turns Composio session permission failures into an actionable localized message', () => {
    const providerError = new Error(
      '403 {"error":{"message":"This route requires \\"session_management\\" write access",'
      + '"code":812,"slug":"APIKey_InsufficientPermissions"}}',
    );

    expect(formatComposioError(providerError, messages('zh').connectorsSettings))
      .toContain('session_management 写入权限');
    expect(formatComposioError(providerError, messages('en').connectorsSettings))
      .toContain('session_management write permission');
  });

  it('preserves unrelated errors', () => {
    expect(formatComposioError(new Error('Network unavailable'), messages('en').connectorsSettings))
      .toBe('Network unavailable');
  });
});
