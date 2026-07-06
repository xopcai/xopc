import { describe, expect, it } from 'vitest';

import { consumeContentChatIntake, setContentChatIntake } from '../content-chat-handoff';
import { analyzeIntakeContent, shouldOfferContentIntake } from '../content-intent';
import { buildContentIntakeNoteMarkdown } from '../content-note-markdown';
import { buildIntakeRoute, buildRouteIntakeText } from '../route-intake';
import { savedContentRoute } from '../save-navigation';

describe('content chat intake handoff', () => {
  it('only consumes matching session intake once', () => {
    setContentChatIntake({ sessionKey: 'agent:one', text: 'Explore this', prompt: 'Prompt', source: 'clipboard' });

    expect(consumeContentChatIntake('agent:two')).toBeNull();
    expect(consumeContentChatIntake('agent:one')).toEqual({
      sessionKey: 'agent:one',
      text: 'Explore this',
      prompt: 'Prompt',
      source: 'clipboard',
    });
    expect(consumeContentChatIntake('agent:one')).toBeNull();
  });

  it('keeps only the latest pending chat intake', () => {
    setContentChatIntake({ sessionKey: 'agent:old', text: 'Old', prompt: 'Old prompt', source: 'clipboard' });
    setContentChatIntake({ sessionKey: 'agent:new', text: 'New', prompt: 'New prompt', source: 'share' });

    expect(consumeContentChatIntake('agent:old')).toBeNull();
    expect(consumeContentChatIntake('agent:new')).toEqual({
      sessionKey: 'agent:new',
      text: 'New',
      prompt: 'New prompt',
      source: 'share',
    });
  });
});

describe('content intent', () => {
  it('filters low-value snippets', () => {
    expect(shouldOfferContentIntake('42')).toBe(false);
    expect(shouldOfferContentIntake('123456')).toBe(false);
    expect(shouldOfferContentIntake('Your verification code is 123456')).toBe(false);
    expect(shouldOfferContentIntake('验证码 123456，请勿泄露给他人')).toBe(false);
    expect(shouldOfferContentIntake('!!!')).toBe(false);
    expect(shouldOfferContentIntake('😂😂😂')).toBe(false);
    expect(shouldOfferContentIntake('useful text')).toBe(true);
    expect(shouldOfferContentIntake('有用的内容')).toBe(true);
  });

  it('classifies links with link-specific actions', () => {
    const intent = analyzeIntakeContent('https://example.com/post');

    expect(intent.type).toBe('url');
    expect(intent.noteKind).toBe('bookmark');
    expect(intent.saveActionKey).toBe('saveLink');
    expect(intent.chatActionKey).toBe('summarizeLink');
    expect(intent.chatPrompt).toContain('https://example.com/post');
  });

  it('classifies shared links with titles as links', () => {
    const intent = analyzeIntakeContent('Article title\nhttps://example.com/post');

    expect(intent.type).toBe('url');
    expect(intent.noteKind).toBe('bookmark');
    expect(intent.saveActionKey).toBe('saveLink');
    expect(intent.chatActionKey).toBe('summarizeLink');
  });

  it('classifies checklist content', () => {
    const intent = analyzeIntakeContent('- [ ] draft plan\n- [ ] review');

    expect(intent.type).toBe('todo');
    expect(intent.noteKind).toBe('todo');
    expect(intent.saveActionKey).toBe('saveChecklist');
    expect(intent.chatActionKey).toBe('organizeChecklist');
  });

  it('classifies code content', () => {
    const intent = analyzeIntakeContent('function run() {\n  return 1;\n}');

    expect(intent.type).toBe('code');
    expect(intent.saveActionKey).toBe('saveCode');
    expect(intent.chatActionKey).toBe('explainCode');
  });

  it('masks sensitive preview while preserving prompt content', () => {
    const text = 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz';
    const intent = analyzeIntakeContent(text);

    expect(intent.isSensitive).toBe(true);
    expect(intent.previewText).toContain('[hidden]');
    expect(intent.chatPrompt).toContain(text);
  });

  it('masks assigned secret values in preview', () => {
    const text = 'api_key="abcdef1234567890"\npassword: super secret value';
    const intent = analyzeIntakeContent(text);

    expect(intent.isSensitive).toBe(true);
    expect(intent.previewText).toContain('api_key="[hidden]"');
    expect(intent.previewText).toContain('password: [hidden]');
    expect(intent.previewText).not.toContain('abcdef1234567890');
    expect(intent.previewText).not.toContain('super secret value');
    expect(intent.chatPrompt).toContain(text);
  });

  it('masks personal information in preview', () => {
    const text = 'Reach me at user@example.com or +1 415 555 0123. Card 4242 4242 4242 4242';
    const intent = analyzeIntakeContent(text);

    expect(intent.isSensitive).toBe(true);
    expect(intent.previewText).toContain('[email hidden]');
    expect(intent.previewText).toContain('[phone hidden]');
    expect(intent.previewText).toContain('[number hidden]');
    expect(intent.previewText).not.toContain('user@example.com');
    expect(intent.previewText).not.toContain('4242 4242 4242 4242');
    expect(intent.chatPrompt).toContain(text);
  });
});

describe('content note markdown', () => {
  it('saves titled links as markdown links', () => {
    const text = 'Article [draft]\nhttps://example.com/post';

    expect(buildContentIntakeNoteMarkdown(text, analyzeIntakeContent(text))).toBe(
      '[Article \\[draft\\]](https://example.com/post)',
    );
  });

  it('keeps plain links as-is', () => {
    const text = 'https://example.com/post';

    expect(buildContentIntakeNoteMarkdown(text, analyzeIntakeContent(text))).toBe(text);
  });

  it('keeps two-line links as-is when the title line is also a URL', () => {
    const text = 'https://example.com/source\nhttps://example.com/post';

    expect(buildContentIntakeNoteMarkdown(text, analyzeIntakeContent(text))).toBe(text);
  });

  it('keeps titled links as-is when the URL is not safe for markdown link syntax', () => {
    const text = 'Article\nhttps://example.com/post)';

    expect(buildContentIntakeNoteMarkdown(text, analyzeIntakeContent(text))).toBe(text);
  });

  it('wraps raw code snippets in a fenced block', () => {
    const text = 'function run() {\n  return 1;\n}';

    expect(buildContentIntakeNoteMarkdown(text, analyzeIntakeContent(text))).toBe(
      '```\nfunction run() {\n  return 1;\n}\n```',
    );
  });

  it('does not double-wrap fenced code snippets', () => {
    const text = '```\nconst value = 1;\n```';

    expect(buildContentIntakeNoteMarkdown(text, analyzeIntakeContent(text))).toBe(text);
  });

  it('normalizes todo snippets to markdown checklists', () => {
    const text = 'todo: Draft plan\n* Review scope\n[x] Ship';

    expect(buildContentIntakeNoteMarkdown(text, analyzeIntakeContent(text))).toBe(
      '- [ ] Draft plan\n- [ ] Review scope\n- [x] Ship',
    );
  });
});

describe('route intake params', () => {
  it('prefers shared text over url/title', () => {
    expect(buildRouteIntakeText({ text: 'Shared text', title: 'Title', url: 'https://xopc.ai' })).toBe('Shared text');
  });

  it('combines shared url text with title', () => {
    expect(buildRouteIntakeText({ text: 'https://xopc.ai/post', title: 'Article' })).toBe('Article\nhttps://xopc.ai/post');
  });

  it('combines title and url for shared links', () => {
    expect(buildRouteIntakeText({ title: 'Article', url: 'https://xopc.ai/post' })).toBe('Article\nhttps://xopc.ai/post');
  });

  it('uses the first non-empty value from repeated route params', () => {
    expect(buildRouteIntakeText({ text: ['  ', 'Shared text'] })).toBe('Shared text');
  });

  it('does not use title-only route params as intake content', () => {
    expect(buildRouteIntakeText({ title: 'Article' })).toBe('');
  });

  it('builds the canonical intake route without empty params', () => {
    expect(buildIntakeRoute({ text: '  Shared text  ', title: '  ' })).toEqual({
      pathname: '/intake',
      params: { text: 'Shared text' },
    });
  });
});

describe('saved content route', () => {
  it('opens the saved note when the gateway returns an id', () => {
    expect(savedContentRoute({ status: 'saved', noteId: 'note-1' })).toBe('/items/note-1');
  });

  it('encodes saved note ids before routing', () => {
    expect(savedContentRoute({ status: 'saved', noteId: 'folder/note 1' })).toBe('/items/folder%2Fnote%201');
  });

  it('falls back home for queued saves', () => {
    expect(savedContentRoute({ status: 'queued' })).toBe('/');
  });
});
