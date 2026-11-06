export function isChatReplyOutput(output: string): boolean {
  return /(?:对话|聊天)(?:内|中|里|正文|回复|答复)|中文(?:回复|答复)|\b(?:chat|in-chat) (?:reply|response|answer)\b|\b(?:reply|response|answer) in (?:this )?chat\b/iu.test(output);
}

export function finalReplyCharacterLimit(criterion: string): number | undefined {
  if (!/(?:回复|答复|\b(?:reply|response)\b)/iu.test(criterion)) return undefined;
  const limit = criterion.match(/(?:不超过|最多|至多|限于)\s*([1-9]\d*)\s*(?:个\s*)?(?:字符|汉字|字)(?!段|节|体|样)/u)?.[1]
    ?? criterion.match(/([1-9]\d*)\s*(?:个\s*)?(?:字符|汉字|字)\s*(?:以内|以下)/u)?.[1]
    ?? criterion.match(/(?:at most|no more than|up to|maximum(?: of)?|limit of)\s+([1-9]\d*)\s+characters?\b/iu)?.[1];
  return limit === undefined ? undefined : Number(limit);
}
