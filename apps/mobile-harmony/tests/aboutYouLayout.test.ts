import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const aboutYou = readFileSync(new URL('../entry/src/main/ets/view/AboutYouView.ets', import.meta.url), 'utf8');

describe('about you understanding layout', () => {
  it('keeps search in the header and conversation editing at the fixed bottom action area', () => {
    const headerStart = aboutYou.indexOf('private mainHeader()');
    const filtersStart = aboutYou.indexOf('private understandingFilters()');
    const footerStart = aboutYou.indexOf('private understandingConversationAction()');

    expect(headerStart).toBeGreaterThan(-1);
    expect(aboutYou.indexOf(".id('about-you-search')", headerStart)).toBeLessThan(filtersStart);
    expect(footerStart).toBeGreaterThan(filtersStart);
    expect(aboutYou).toContain('this.understandingConversationAction()');
    expect(aboutYou).toContain(".id('about-you-search-open')");
    expect(aboutYou).toContain(".id('about-you-search-close')");
    expect(aboutYou).not.toContain('private understandingTools()');
  });
});
