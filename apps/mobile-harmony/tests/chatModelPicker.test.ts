import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const options = readFileSync(new URL('../entry/src/main/ets/view/ChatOptions.ets', import.meta.url), 'utf8');
const components = readFileSync(new URL('../entry/src/main/ets/view/MobileComponents.ets', import.meta.url), 'utf8');

describe('chat model picker interaction contract', () => {
  it('keeps model rows actionable while hiding their navigation chevron', () => {
    expect(options).toContain('summary: item.id, showChevron: false, onOpen: async');
    expect(options).not.toContain('summary: item.id, navigable: false');
    expect(components).toContain('if (this.navigable && this.showChevron)');
    expect(components).toContain('if (this.navigable) this.onOpen();');
  });
});
