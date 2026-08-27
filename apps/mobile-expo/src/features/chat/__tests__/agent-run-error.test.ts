import { describe, expect, it } from 'vitest';

import {
  formatMobileAgentRunError,
  parseMobileAgentRunError,
} from '../agent-run-error';

const copy = {
  modelQuotaExhausted: '模型额度已用完',
  platformTokenLimitExceeded: '平台额度已达上限',
};

describe('mobile agent run errors', () => {
  const quotaPayload = {
    kind: 'xopc_quota_exhausted',
    code: 'model_quota_exhausted',
    message: '402: {"message":"Model quota exhausted","type":"insufficient_quota"}',
    provider: 'xopc-cloud',
    modelRef: 'xopc-cloud/deepseek-v4-flash',
  };

  it('parses a structured quota error without exposing protocol fields', () => {
    expect(parseMobileAgentRunError(JSON.stringify(quotaPayload))).toEqual(quotaPayload);
    expect(formatMobileAgentRunError(JSON.stringify(quotaPayload), copy)).toBe('模型额度已用完');
  });

  it('accepts Error-prefixed and double-encoded structured errors', () => {
    const encoded = JSON.stringify(JSON.stringify(quotaPayload));
    expect(formatMobileAgentRunError(`Error: ${encoded}`, copy)).toBe('模型额度已用完');
  });

  it('shows only the inner message for other structured errors', () => {
    const raw = JSON.stringify({ kind: 'timeout', code: 'timeout', message: 'Request timed out' });
    expect(formatMobileAgentRunError(raw, copy)).toBe('Request timed out');
  });

  it('preserves legacy plain-text errors', () => {
    expect(formatMobileAgentRunError('Network request failed', copy)).toBe('Network request failed');
  });
});
