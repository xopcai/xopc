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

  it('uses selection controls for bounded profile fields and keeps open fields editable', () => {
    const editorStart = aboutYou.indexOf('private profileEditor()');
    const editor = aboutYou.slice(editorStart, aboutYou.indexOf('\n  build()', editorStart));

    expect(editor).toContain('Select(this.pronounOptions())');
    expect(editor).toContain('Select(this.timezoneOptions())');
    expect(editor).toContain('Select(this.localeOptions())');
    expect(editor).toContain('TextInput({ text: this.callName');
    expect(editor).toContain('TextInput({ text: this.role');
    expect(editor).toContain('if (this.customPronouns)');
    expect(editor).toContain('Scroll()');
  });

  it('keeps empty understanding guidance near the filters with context-specific copy', () => {
    const listStart = aboutYou.indexOf('private understandingList()');
    const list = aboutYou.slice(listStart, aboutYou.indexOf('\n  @Builder\n  private profileEditor()', listStart));

    expect(list).toContain('Text(this.emptyTitle())');
    expect(list).toContain('Text(this.emptyHelp())');
    expect(list).toContain("backgroundColor(this.colors.panel)");
    expect(aboutYou).toContain("this.model.filter === 'review'");
    expect(aboutYou).toContain('about_you_empty_search_title');
  });
});
