import { describe, expect, it } from 'vitest';

import { extensionForImageMimeType } from '../clipboard-image.js';

describe('clipboard image helpers', () => {
  it('maps mime types to extensions', () => {
    expect(extensionForImageMimeType('image/png')).toBe('png');
    expect(extensionForImageMimeType('image/jpeg')).toBe('jpg');
  });
});
