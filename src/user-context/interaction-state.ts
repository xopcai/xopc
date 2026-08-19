export type SupportNeed = 'listen' | 'clarify' | 'advise' | 'act' | 'unknown';
export type InteractionStateSource = 'explicit' | 'inferred';
export type RelationshipRepairStatus = 'none' | 'needed' | 'repaired';

export interface InteractionStateSignal {
  supportNeed: SupportNeed;
  emotionHypothesis?: string;
  confidence: number;
  source: InteractionStateSource;
  repairStatus: RelationshipRepairStatus;
  repairReason?: string;
}

export function inferInteractionState(message: string): InteractionStateSignal {
  const text = message.trim().toLocaleLowerCase();
  const emotion = text.match(/(焦虑|难过|委屈|生气|疲惫|累|害怕|孤独|anxious|sad|angry|exhausted|afraid|lonely)/)?.[1];
  if (/你.{0,6}(没|不).{0,6}(理解|懂)|别.{0,4}(建议|说教)|太(啰嗦|冷淡)|you (do not|don't) understand|stop giving (me )?advice|too verbose|too cold/.test(text)) {
    return {
      supportNeed: 'listen',
      confidence: 0.95,
      source: 'explicit',
      repairStatus: 'needed',
      repairReason: message.trim().slice(0, 240),
    };
  }
  if (/这样(好多|对了)|这次对了|谢谢.{0,6}(理解|调整)|that's better|you got it|this is better/.test(text)) {
    return { supportNeed: 'unknown', confidence: 0.9, source: 'explicit', repairStatus: 'repaired' };
  }
  if (/不想听建议|只想.{0,4}(说|聊|倾诉)|听我说|no advice|just (listen|let me talk)/.test(text)) {
    return { supportNeed: 'listen', confidence: 0.95, source: 'explicit', repairStatus: 'none' };
  }
  if (/帮我(梳理|理清|想清楚)|一起分析|help me (clarify|think through)|talk this through/.test(text)) {
    return { supportNeed: 'clarify', confidence: 0.9, source: 'explicit', repairStatus: 'none' };
  }
  if (/你建议|怎么办|该怎么|给我建议|what should i do|what do you recommend|advice/.test(text)) {
    return { supportNeed: 'advise', confidence: 0.9, source: 'explicit', repairStatus: 'none' };
  }
  if (/帮我.{0,8}(做|改|创建|实现|处理|发送|修好)|请(完成|执行)|\b(build|fix|create|implement|send|run)\b/.test(text)) {
    return {
      supportNeed: 'act',
      ...(emotion ? { emotionHypothesis: emotion } : {}),
      confidence: 0.85,
      source: 'explicit',
      repairStatus: 'none',
    };
  }
  if (emotion) {
    return {
      supportNeed: 'listen',
      emotionHypothesis: emotion,
      confidence: 0.55,
      source: 'inferred',
      repairStatus: 'none',
    };
  }
  return { supportNeed: 'unknown', confidence: 0.3, source: 'inferred', repairStatus: 'none' };
}

export function buildInteractionStatePrompt(signal: InteractionStateSignal): string {
  const guidance: Record<SupportNeed, string> = {
    listen: 'Prioritize listening and acknowledgment. Do not rush into advice or an action list.',
    clarify: 'Help the user organize the situation with one focused question at a time.',
    advise: 'Offer a clear recommendation with concise reasoning and practical options.',
    act: 'Prioritize execution, state the intended task, and verify the result. Care must support progress, not replace it.',
    unknown: 'Do not assume the support needed. If it matters, ask one concise question.',
  };
  const lines = ['## Current interaction state', guidance[signal.supportNeed]];
  if (signal.emotionHypothesis) {
    lines.push(`Possible current emotion: ${signal.emotionHypothesis} (confidence ${signal.confidence.toFixed(2)}). Treat this only as a hypothesis.`);
    if (signal.supportNeed === 'act') {
      lines.push('Acknowledge the pressure in one natural sentence, then continue doing the work without making the user manage your feelings.');
    }
  }
  if (signal.repairStatus === 'needed') {
    lines.push('Relationship repair is needed: briefly acknowledge the specific mismatch, do not defend yourself, adjust immediately, and ask at most one concise question.');
  }
  return lines.join('\n\n');
}
