import { describe, expect, it } from 'vitest';

import {
  buildFollowUpContextPack,
  followUpPromptForSuggestionId,
  suggestFollowUps,
  suggestFollowUpsFromAssistantMessage,
} from '@/features/chat/follow-up-suggestions';
import type { Message } from '@/features/chat/messages.types';

describe('suggestFollowUpsFromAssistantMessage', () => {
  it('returns generic suggestion ids for plain text', () => {
    const msg: Message = {
      role: 'assistant',
      content: [{ type: 'text', text: 'Here is an overview of the topic with enough length to matter.' }],
      timestamp: 1,
    };
    const s = suggestFollowUpsFromAssistantMessage(msg);
    expect(s.length).toBeGreaterThanOrEqual(3);
    expect(s).toContain('generic_concrete_example');
    expect(s).toContain('what_next');
  });

  it('biases toward code-oriented ids when code-like', () => {
    const msg: Message = {
      role: 'assistant',
      content: [{ type: 'text', text: 'Use `export function foo()` in your module.' }],
      timestamp: 1,
    };
    const s = suggestFollowUpsFromAssistantMessage(msg);
    expect(s).toContain('code_error_handling');
    expect(s).toContain('what_next');
  });

  it('includes web chips when URLs or references appear alongside code', () => {
    const msg: Message = {
      role: 'assistant',
      content: [
        {
          type: 'text',
          text:
            'See https://example.com/doc for the API. ```ts\nexport async function fetch() {}\n```',
        },
      ],
      timestamp: 1,
    };
    const s = suggestFollowUpsFromAssistantMessage(msg);
    expect(s.some((id) => id.startsWith('code_'))).toBe(true);
    expect(s).toContain('web_more_details');
  });

  it('includes email chips for common letter patterns', () => {
    const msg: Message = {
      role: 'assistant',
      content: [
        {
          type: 'text',
          text:
            'Dear team,\n\nHere is the update.\n\nBest regards,\nAlex\n\n' +
            'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor.',
        },
      ],
      timestamp: 1,
    };
    const s = suggestFollowUpsFromAssistantMessage(msg);
    expect(s.some((id) => id === 'email_make_formal' || id === 'email_shorten')).toBe(true);
  });

  it('returns empty for non-assistant', () => {
    const msg: Message = {
      role: 'user',
      content: [{ type: 'text', text: 'Hi' }],
      timestamp: 1,
    };
    expect(suggestFollowUpsFromAssistantMessage(msg)).toEqual([]);
  });
});

describe('suggestFollowUps with context pack', () => {
  it('prefers code_fix_error when user reports an error', () => {
    const user: Message = {
      role: 'user',
      content: [{ type: 'text', text: 'export function foo() throws TypeError at runtime' }],
      timestamp: 1,
    };
    const assistant: Message = {
      role: 'assistant',
      content: [
        {
          type: 'text',
          text: 'TypeError: Cannot read properties of undefined\n    at foo (app.ts:12:3)',
        },
      ],
      timestamp: 2,
    };
    const messages = [user, assistant];
    const ctx = buildFollowUpContextPack({ messages, appendedAssistant: assistant, locale: 'en' });
    expect(ctx).not.toBeNull();
    const s = suggestFollowUps(ctx!);
    expect(s).toContain('code_fix_error');
    expect(s).toContain('what_next');
    expect(s.indexOf('code_fix_error')).toBeLessThan(s.indexOf('what_next'));
  });

  it('down-ranks bullet summary when assistant already listed bullets', () => {
    const assistant: Message = {
      role: 'assistant',
      content: [
        {
          type: 'text',
          text: '- First point\n- Second point\n- Third point\n- Fourth point with enough text.',
        },
      ],
      timestamp: 1,
    };
    const ctx = buildFollowUpContextPack({ messages: [assistant], appendedAssistant: assistant });
    const s = suggestFollowUps(ctx!);
    expect(s).not.toContain('generic_bullet_points');
  });

  it('returns empty when clarify is active', () => {
    const assistant: Message = {
      role: 'assistant',
      content: [{ type: 'text', text: 'Some answer with enough length to be substantial for scoring.' }],
      timestamp: 1,
    };
    const ctx = buildFollowUpContextPack({
      messages: [assistant],
      appendedAssistant: assistant,
      clarifyActive: true,
    });
    expect(suggestFollowUps(ctx!)).toEqual([]);
  });

  it('omits web chips when capWebSearch is false', () => {
    const assistant: Message = {
      role: 'assistant',
      content: [
        {
          type: 'text',
          text: 'See https://example.com for docs. ' + 'x'.repeat(100),
        },
      ],
      timestamp: 1,
    };
    const ctx = buildFollowUpContextPack({
      messages: [assistant],
      appendedAssistant: assistant,
      capabilities: { capWebSearch: false, capWebFetch: false, capShell: true, capBrowser: true, capCron: true },
    });
    const s = suggestFollowUps(ctx!);
    expect(s.some((id) => id.startsWith('web_'))).toBe(false);
    expect(s).not.toContain('research_deeper');
  });

  it('suggests learn chips for RAG explainer with diagram fence, not code chips', () => {
    const user: Message = {
      role: 'user',
      content: [{ type: 'text', text: '用通俗的方式讲讲 RAG 是怎么回事' }],
      timestamp: 1,
    };
    const ragExplain =
      '当然！让我用最通俗的方式给你讲讲 RAG 是怎么回事。\n\n' +
      'RAG（检索增强生成）就像是开卷考试的学生。\n\n' +
      '第一步：建索引\n第二步：检索\n第三步：生成\n\n' +
      '为什么需要 RAG？\n\n| 问题 | RAG 怎么解决 |\n| --- | --- |\n| 知识过时 | 查最新文档 |\n\n' +
      '```\n复制\n你提问 ⟶ 在知识库里搜索 ⟶ 大模型回答\n```\n\n' +
      '简单来说：RAG = 搜索 + 问答。\n\n' +
      '有什么想深入了解的吗？比如具体的技术实现，或者想看看怎么搭建一个？';
    const assistant: Message = {
      role: 'assistant',
      content: [{ type: 'text', text: ragExplain }],
      timestamp: 2,
    };
    const ctx = buildFollowUpContextPack({
      messages: [user, assistant],
      appendedAssistant: assistant,
      locale: 'zh',
    });
    const s = suggestFollowUps(ctx!);
    expect(s).not.toContain('code_error_handling');
    expect(s).not.toContain('code_explain');
    expect(s).not.toContain('generic_action_checklist');
    expect(s.some((id) => id.startsWith('learn_'))).toBe(true);
    expect(s).toContain('what_next');
  });

  it('suggests ops_channel_next for gateway setup questions', () => {
    const user: Message = {
      role: 'user',
      content: [{ type: 'text', text: 'How do I configure telegram channel in gateway?' }],
      timestamp: 1,
    };
    const assistant: Message = {
      role: 'assistant',
      content: [{ type: 'text', text: 'Enable channels.telegram in xopc.json and set botToken...' }],
      timestamp: 2,
    };
    const messages = [user, assistant];
    const ctx = buildFollowUpContextPack({ messages, appendedAssistant: assistant });
    const s = suggestFollowUps(ctx!);
    expect(s.some((id) => id === 'ops_channel_next' || id === 'ops_fix_config')).toBe(true);
  });
});

describe('followUpPromptForSuggestionId', () => {
  it('returns English prompts for every suggestion id', () => {
    const ids = suggestFollowUpsFromAssistantMessage({
      role: 'assistant',
      content: [{ type: 'text', text: 'x'.repeat(120) }],
      timestamp: 1,
    });
    for (const id of ids) {
      const p = followUpPromptForSuggestionId(id, 'en');
      expect(p.length).toBeGreaterThan(10);
      expect(p).toMatch(/[a-z]/i);
    }
  });

  it('returns Chinese prompts when locale is zh', () => {
    const p = followUpPromptForSuggestionId('what_next', 'zh');
    expect(p).toMatch(/[\u4e00-\u9fff]/);
  });
});
