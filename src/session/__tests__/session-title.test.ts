import { describe, expect, it } from 'vitest';

import {
  fallbackTitleFromMessages,
  provisionalTitleFromUserText,
  sanitizeGeneratedSessionTitle,
  shouldAutoTitleSessionKey,
  shouldRefineSessionTitleWithLlm,
} from '../session-title.ts';

describe('shouldAutoTitleSessionKey', () => {
  it('allows webchat, telegram, weixin-style keys', () => {
    expect(shouldAutoTitleSessionKey('agent:main:webchat:default:direct:chat_abc')).toBe(true);
    expect(shouldAutoTitleSessionKey('agent:main:telegram:acc_default:direct:123456')).toBe(true);
    expect(shouldAutoTitleSessionKey('agent:main:weixin:acc_default:direct:openid123')).toBe(true);
  });

  it('rejects cron sessions', () => {
    expect(shouldAutoTitleSessionKey('agent:main:cron:job-123')).toBe(false);
  });

  it('rejects heartbeat keys', () => {
    expect(shouldAutoTitleSessionKey('heartbeat:main')).toBe(false);
    expect(shouldAutoTitleSessionKey('heartbeat:isolated:ts')).toBe(false);
  });

  it('rejects empty key', () => {
    expect(shouldAutoTitleSessionKey('')).toBe(false);
    expect(shouldAutoTitleSessionKey('   ')).toBe(false);
  });
});

describe('provisionalTitleFromUserText', () => {
  it('uses first line and strips envelope timestamp', () => {
    expect(provisionalTitleFromUserText('[2026-01-15 10:00 UTC] 你好')).toBe('你好');
  });

  it('uses skill arguments instead of the expanded skill header', () => {
    expect(
      provisionalTitleFromUserText(
        [
          '',
          '## Skill: hatch-pet',
          '',
          'Create animated pets.',
          '',
          '# Hatch Pet',
          '',
          'Use this skill when making sprite sheets.',
          '',
          '**Arguments**: 生成一个蓝色机器人宠物',
        ].join('\n'),
      ),
    ).toBe('生成一个蓝色机器人宠物');
  });

  it('falls back to the skill name when an expanded skill has no arguments', () => {
    expect(
      provisionalTitleFromUserText(
        ['## Skill: hatch-pet', '', 'Create animated pets.', '', '# Hatch Pet'].join('\n'),
      ),
    ).toBe('hatch-pet');
  });

  it('uses raw skill command arguments when the skill was not expanded', () => {
    expect(provisionalTitleFromUserText('/skill:hatch-pet 做一个水晶风格宠物')).toBe(
      '做一个水晶风格宠物',
    );
  });

  it('returns null for blank input', () => {
    expect(provisionalTitleFromUserText('   ')).toBeNull();
  });
});

describe('shouldRefineSessionTitleWithLlm', () => {
  it('allows unnamed sessions and provisional titles', () => {
    expect(shouldRefineSessionTitleWithLlm({})).toBe(true);
    expect(shouldRefineSessionTitleWithLlm({ name: 'Hi', customData: { titleSource: 'provisional' } })).toBe(
      true,
    );
  });

  it('skips user-locked and finalized titles (including legacy named rows without titleSource)', () => {
    expect(shouldRefineSessionTitleWithLlm({ name: 'Locked', customData: { titleSource: 'user' } })).toBe(
      false,
    );
    expect(shouldRefineSessionTitleWithLlm({ name: 'Refined', customData: { titleSource: 'llm' } })).toBe(
      false,
    );
    expect(shouldRefineSessionTitleWithLlm({ name: 'Legacy title' })).toBe(false);
  });

  it('retries finalized LLM titles that only contain a reasoning tag', () => {
    expect(
      shouldRefineSessionTitleWithLlm({ name: '<think>', customData: { titleSource: 'llm' } }),
    ).toBe(true);
  });
});

describe('sanitizeGeneratedSessionTitle', () => {
  it('removes a complete leading think block', () => {
    expect(
      sanitizeGeneratedSessionTitle('<think>\nI should summarize this chat.\n</think>\n修复会话标题'),
    ).toBe('修复会话标题');
  });

  it('removes consecutive reasoning blocks and title quotes', () => {
    expect(
      sanitizeGeneratedSessionTitle(
        '<analysis>Inspect the request</analysis>\n<reasoning>Choose a title</reasoning>\n"Session title fix"',
      ),
    ).toBe('Session title fix');
  });

  it('rejects unclosed or tag-only reasoning output', () => {
    expect(sanitizeGeneratedSessionTitle('<think>')).toBe('');
    expect(sanitizeGeneratedSessionTitle('<think>\nStill reasoning')).toBe('');
    expect(sanitizeGeneratedSessionTitle('</think>')).toBe('');
  });
});

describe('fallbackTitleFromMessages', () => {
  it('ignores leading envelope timestamp on first user message', () => {
    const title = fallbackTitleFromMessages([
      {
        role: 'user',
        content: [{ type: 'text', text: '[2026-01-15 10:00 UTC] 你好' }],
      },
    ]);
    expect(title).toBe('你好');
  });

  it('uses expanded skill arguments for user-message fallback titles', () => {
    const title = fallbackTitleFromMessages([
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: [
              '## Skill: hatch-pet',
              '',
              'Create animated pets.',
              '',
              '**Arguments**: make a tiny space rover pet',
            ].join('\n'),
          },
        ],
      },
    ]);
    expect(title).toBe('make a tiny space rover pet');
  });
});
