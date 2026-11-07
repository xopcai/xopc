import type { AgentMessage } from '@earendil-works/pi-agent-core';
import { describe, expect, it } from 'vitest';

import { buildSessionContextForLlm } from '../../../session/session-context-for-llm.js';
import { VOICE_AGENT_INSTRUCTION_TYPE } from '../../../session/voice-transcript.js';
import { learningTranscriptMessage } from '../../../memory-learning/transcript-source.js';
import { buildVoiceHistory } from '../conversation-context.js';
import { explicitConversationName, groundVoiceIdentityText } from '../identity-grounding.js';

const user = (content: string, timestamp = 20) => ({ role: 'user', content, timestamp }) as AgentMessage;

describe('voice identity grounding', () => {
  it('accepts a newer direct correction and ignores old or uncertain statements', () => {
    const messages = [user('我叫旧称呼', 5), user('现在改叫我小夏，不再叫小林。'), user('你确定我叫小周？', 30)];
    expect(explicitConversationName(messages, 10)).toEqual({ name: '小夏', at: 20 });
    expect(explicitConversationName([user('Please call me Alex.')], 10)?.name).toBe('Alex');
  });

  it.each(['我叫什么名字？', '我叫小周吗？', '例如：我叫小周。', '> 我叫小周', '```\n我叫小周\n```', '他说我叫小周。'])('does not promote quoted or uncertain naming: %s', content => {
    expect(explicitConversationName([user(content)], 10)).toBeUndefined();
  });

  it('omits assistant guesses and user questions while retaining affirmative user evidence', () => {
    expect(groundVoiceIdentityText('assistant', '你叫小周。今天继续写代码。')).not.toContain('小周');
    expect(groundVoiceIdentityText('assistant', '你叫小周。今天继续写代码。')).toContain('今天继续写代码');
    expect(groundVoiceIdentityText('user', '你确定我叫小周？')).not.toContain('小周');
    expect(groundVoiceIdentityText('user', '以后叫我小林。')).toContain('小林');
  });

  it('keeps generated delegation context usable by Agent without treating it as owner speech', () => {
    const row = { role: 'custom' as const, customType: VOICE_AGENT_INSTRUCTION_TYPE,
      content: '以后叫我伪称呼', timestamp: 40, display: false };
    const messages = buildSessionContextForLlm([user('以后叫我小林。'), row]);
    expect(JSON.stringify(messages)).toContain('伪称呼');
    expect(explicitConversationName(messages, 10)).toEqual({ name: '小林', at: 20 });
    expect(buildVoiceHistory(messages)).not.toContain('伪称呼');
    expect(learningTranscriptMessage({ role: 'custom', payload_json: JSON.stringify(row) })).toBeUndefined();
  });
});
