import { describe, expect, it } from 'vitest';
import { COMPOSER_INPUT_MIN, COMPOSER_INPUT_MAX, COMPOSER_TOOL_SIZE, COMPOSER_SEND_SIZE,
  composerExpanded, composerHasPayload } from '../entry/src/main/ets/common/composerLayout';

describe('composer parity with Android/iOS', () => {
  it('uses the same input and action dimensions', () => {
    expect([COMPOSER_INPUT_MIN, COMPOSER_INPUT_MAX, COMPOSER_TOOL_SIZE, COMPOSER_SEND_SIZE]).toEqual([40, 120, 36, 44]);
  });
  it('collapses an empty composer and hides its send action', () => {
    expect(composerExpanded('', 0, 0, false)).toBe(false);
    expect(composerHasPayload('', 0, 0)).toBe(false);
  });
  it.each(['hello', '还好的', '\n', ' '])('keeps editing expanded for %j', (text) => {
    expect(composerExpanded(text, 0, 0, false)).toBe(true);
    expect(composerHasPayload(text, 0, 0)).toBe(Boolean(text.trim()));
  });
  it('retains send for attachment-only and reference-only drafts', () => {
    expect(composerExpanded('', 1, 0, false)).toBe(true);
    expect(composerExpanded('', 0, 1, false)).toBe(true);
    expect(composerHasPayload('', 1, 0)).toBe(true);
    expect(composerHasPayload('', 0, 1)).toBe(true);
  });
  it('keeps the palette expanded without inventing a sendable payload', () => {
    expect(composerExpanded('', 0, 0, true)).toBe(true);
    expect(composerHasPayload('', 0, 0)).toBe(false);
  });
});
