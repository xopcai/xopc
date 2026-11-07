import type { AgentMessage } from '@earendil-works/pi-agent-core';

import { stripRuntimeContextFromUserMessage } from '../../session/user-message-display.js';
import { isVoiceAgentInstruction, isVoiceDelegationMessage } from '../../session/voice-transcript.js';

/** Only direct, affirmative forms; questions, examples and quoted material cannot set a name. */
export function explicitConversationName(messages: readonly AgentMessage[], after: number): { name: string; at: number } | undefined {
  let latest: { name: string; at: number } | undefined;
  for (const message of messages) {
    if (message.role !== 'user' || isVoiceAgentInstruction(message) || isVoiceDelegationMessage(message) || !Number.isFinite(message.timestamp) || message.timestamp <= after) continue;
    const content = typeof message.content === 'string' ? message.content : message.content
      .filter(part => part.type === 'text').map(part => part.type === 'text' ? part.text : '').join('\n');
    const text = stripRuntimeContextFromUserMessage(content).replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/gu, '').replace(/^\s*>.*$/gmu, '');
    if (/例如|比如|假如|假设|举例|for example|suppose/iu.test(text)) continue;
    for (const clause of text.match(/[^，,。.!！？?；;\n]+[，,。.!！？?；;\n]?/gu) ?? []) {
      if (/[？?]\s*$/u.test(clause)) continue;
      const statement = clause.trim().replace(/[，,。.!；;]+$/u, '').trim();
      const match = /^(?:(?:你好|您好|嗨)[，,\s]*)?(?:(?:现在|以后|今后|请|从现在开始)?(?:改)?(?:叫我|称呼我)|我(?:就)?叫|我的(?:名字|姓名)是)\s*(.{1,80})$/u.exec(statement)
        ?? /^(?:my name is|please call me|call me)\s+(.{1,80})$/iu.exec(statement);
      const name = match?.[1]?.trim().replace(/(?:就好|就行|即可|谢谢)$/u, '').trim();
      if (!name || /[<>\[\]{}"“”‘’]|(?:吗|么|什么|谁|是不是|是否|不确定|的话)|^(?:你|他|她|它)|\b(?:what|who|maybe|if)\b/iu.test(name)) continue;
      if (!latest || message.timestamp >= latest.at) latest = { name, at: message.timestamp };
    }
  }
  return latest;
}

/** History is retained on disk; unsupported identity claims are omitted only from the voice projection. */
export function groundVoiceIdentityText(role: 'user' | 'assistant', text: string): string {
  return text.replace(/[^，,。.!！？?；;\n]+[，,。.!！？?；;\n]?/gu, sentence => {
    if (role === 'assistant' && /你叫|你的(?:名字|姓名|昵称|称呼)(?:是|叫)|(?:叫你|称呼你)|\byour (?:name|nickname) is\b|\bi (?:call|address) you\b/iu.test(sentence)) {
      return '[Earlier assistant name claim omitted; it is not user confirmation.]';
    }
    if (role === 'user' && /我叫|我的(?:名字|姓名)|\bmy name\b/iu.test(sentence)
      && (/[？?]\s*$/u.test(sentence) || /你确定|你以为|你认为|你说|是不是|是否|\bare you sure\b|\bdo you think\b/iu.test(sentence))) {
      return '[Earlier user question about a name omitted; it is not a self-introduction.]';
    }
    return sentence;
  });
}
