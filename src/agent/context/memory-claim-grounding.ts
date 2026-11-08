import { directPreferenceClauses, hasOwnerMemoryDirective, observedChoiceClauses } from '../../user-model/capture/evidence-policy.js';

/** Ground current-turn save claims for preferences handled by background learning. */
export function implicitMemoryClaimCorrection(userText: string, answer: string, messages: readonly unknown[]): string | undefined {
  if (['remember', 'correct', 'forget', 'confirm'].some(command =>
    hasOwnerMemoryDirective(userText, command as 'remember' | 'correct' | 'forget' | 'confirm'))) return;
  if (!directPreferenceClauses(userText).length && !observedChoiceClauses(userText).length) return;
  const hasReceipt = messages.some(value => {
    const message = value as { role?: string; toolName?: string; isError?: boolean; details?: { status?: string; usable?: boolean } };
    return message?.role === 'toolResult' && message.toolName === 'personal_memory' && !message.isError
      && message.details?.status === 'saved' && message.details.usable === true;
  });
  if (hasReceipt) return;
  const claimsSave = answer.split(/[。.；;!?！？\n]/u).some(clause =>
    !/没有|并未|尚未|还没|不准确|不正确|不能|无法|\b(?:not|haven't|hasn't|cannot|can't)\b/iu.test(clause)
    && /(?:已(?:经)?|刚刚|刚才).{0,60}(?:写进|写入|存进|存入|保存到|记入).{0,25}(?:偏好|记忆|用户理解)|(?:已(?:经)?|已经).{0,15}(?:记住|保存了.{0,10}(?:偏好|习惯|记忆)|记下了.{0,10}(?:偏好|习惯))|\b(?:I've|I have|I just)\s+(?:saved|stored|written|added).{0,50}(?:memory|preferences?|profile)/iu.test(clause));
  if (!claimsSave) return;
  return 'The final acknowledgement claimed a preference was saved, but this turn has no successful usable memory-write receipt. This is an implicit preference handled by background learning, not an explicit save request. Briefly retract the earlier save claim as inaccurate and clarify that no durable write has been confirmed. Do not repeat or imply that a durable write has happened. Do not call a write tool to justify the earlier claim. Then acknowledge briefly in the user\'s language.';
}
