export function isChatReplyOutput(output: string): boolean {
  return /^(?:chat|in_chat)_(?:reply|response|answer)$/iu.test(output.trim())
    || /(?:对话|聊天)(?:内|中|里|正文|回复|答复)|中文(?:回复|答复)|\b(?:chat|in-chat) (?:reply|response|answer)\b|\b(?:reply|response|answer) in (?:this )?chat\b/iu.test(output);
}

export function finalReplyCharacterLimit(criterion: string, chatReplyOnly = false): number | undefined {
  if (!/(?:回复|答复|\b(?:reply|response)\b)/iu.test(criterion)
    && !(chatReplyOnly && isReplyLengthCriterion(criterion, true))) return undefined;
  const limit = criterion.match(/(?:不超过|最多|至多|限于)\s*([1-9]\d*)\s*(?:个\s*)?(?:字符|汉字|字)(?!段|节|体|样)/u)?.[1]
    ?? criterion.match(/([1-9]\d*)\s*(?:个\s*)?(?:字符|汉字|字)\s*(?:以内|以下)/u)?.[1]
    ?? criterion.match(/(?:at most|no more than|up to|maximum(?: of)?|limit of)\s+([1-9]\d*)\s+characters?\b/iu)?.[1];
  return limit === undefined ? undefined : Number(limit);
}

export function isChatOnlyDelivery(outputs: string[]): boolean {
  return outputs.length === 1 && isChatReplyOutput(outputs[0]);
}

export function isReplyLengthCriterion(criterion: string, chatReplyOnly: boolean): boolean {
  const text = criterion.trim().replace(/[.。]$/u, '');
  const subject = /^(?:(?:最终)?(?:对话|聊天)?(?:回复|答复)(?:正文|长度|字数|篇幅)?|(?:总)?篇幅|总字数|全文)\s*/u;
  if (subject.test(text)) {
    const match = subject.exec(text)!;
    if (!chatReplyOnly && !/(?:回复|答复)/u.test(match[0])) return false;
    return /^(?:(?:不超过|最多|至多|限于)\s*[1-9]\d*\s*(?:个\s*)?(?:字符|汉字|字)|(?:控制在|限在)?\s*[1-9]\d*\s*(?:个\s*)?(?:字符|汉字|字)\s*(?:以内|以下))$/u.test(text.slice(match[0].length));
  }
  return /^(?:the )?(?:final )?(?:chat )?(?:reply|response) (?:must be |is |contains? )?(?:at most|no more than|up to|maximum(?: of)?|limit of)\s+[1-9]\d*\s+characters?$/iu.test(text);
}
