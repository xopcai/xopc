const FEISHU_AT_RE = /<at\s+user_id="[^"]*">([^<]*)<\/at>/g;

export function stripFeishuMentions(text: string): string {
  const raw = String(text ?? '');
  return raw.replaceAll(FEISHU_AT_RE, '$1');
}

