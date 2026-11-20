import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const aboutYou = readFileSync(new URL('../entry/src/main/ets/view/AboutYouView.ets', import.meta.url), 'utf8');

describe('about you understanding layout', () => {
  it('keeps search in the header and conversation editing at the fixed bottom action area', () => {
    const pageStart = aboutYou.indexOf('private sectionPage(');
    const buildStart = aboutYou.indexOf('  build()', pageStart);
    const page = aboutYou.slice(pageStart, buildStart);
    const build = aboutYou.slice(buildStart);
    const search = build.indexOf("searchId: 'about-you-search'");
    const pager = build.indexOf('Swiper(this.pager)');
    const filters = page.indexOf('this.understandingFilters()');
    const list = page.indexOf('this.understandingList()');
    const footer = page.indexOf('this.understandingConversationAction()');

    expect(aboutYou).toContain("titleMenuId: 'about-you-menu'");
    expect(aboutYou).toContain("searchId: this.section === 1 ? 'about-you-search-open' : ''");
    expect(build.indexOf('this.mainHeader()')).toBeGreaterThan(-1);
    expect(search).toBeGreaterThan(build.indexOf('this.mainHeader()'));
    expect(pager).toBeGreaterThan(search);
    expect(build).toContain('this.sectionPage(section)');
    expect(filters).toBeGreaterThan(-1);
    expect(list).toBeGreaterThan(filters);
    expect(footer).toBeGreaterThan(list);
    expect(page.slice(list, footer)).toContain("align(Alignment.TopStart).scrollBar(BarState.Off)");
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

  it('shows a concise, context-specific empty state near the filters', () => {
    const listStart = aboutYou.indexOf('private understandingList()');
    const list = aboutYou.slice(listStart, aboutYou.indexOf('\n  @Builder\n  private detail(', listStart));

    expect(list).toContain('Text(this.emptyTitle())');
    expect(list).toContain("backgroundColor(this.colors.panel)");
    expect(aboutYou).toContain("this.model.filter === 'review'");
    expect(aboutYou).toContain('about_you_empty_search_title');
  });
});
