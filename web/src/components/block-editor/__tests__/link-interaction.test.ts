// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { modifiedClickLinkHref } from '../link-interaction';

describe('block editor link interaction', () => {
  it('opens links directly only for modified clicks', () => {
    const anchor = document.createElement('a');
    anchor.href = 'https://example.com/docs';
    const child = document.createElement('span');
    anchor.appendChild(child);

    expect(modifiedClickLinkHref(new MouseEvent('click'))).toBeNull();
    expect(modifiedClickLinkHref(new MouseEvent('click', { ctrlKey: true }))).toBeNull();

    const event = new MouseEvent('click', { metaKey: true, bubbles: true });
    Object.defineProperty(event, 'target', { value: child });
    expect(modifiedClickLinkHref(event)).toBe('https://example.com/docs');
  });
});
