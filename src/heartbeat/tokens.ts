export const HEARTBEAT_OK = 'HEARTBEAT_OK';
export const NO_REPLY = 'NO_REPLY';
export const DEFAULT_ACK_MAX_CHARS = 300;

/**
 * Strip HEARTBEAT_OK token from model text.
 * Supports plain text, Markdown bold, inline code, trailing punctuation.
 */
export function stripHeartbeatToken(text: string): {
  stripped: string;
  hadToken: boolean;
} {
  const hadToken = text.includes(HEARTBEAT_OK);
  const stripped = text
    .replace(/<[^>]*>/g, ' ')
    .replace(/\*\*HEARTBEAT_OK\*\*/g, '')
    .replace(/`HEARTBEAT_OK`/g, '')
    .replace(/HEARTBEAT_OK\.?/g, '')
    .trim();
  return { stripped, hadToken };
}

/**
 * Whether the reply should not be sent to the user: HEARTBEAT_OK present and little else.
 */
export function shouldSilence(
  text: string,
  ackMaxChars: number = DEFAULT_ACK_MAX_CHARS,
): boolean {
  const { stripped, hadToken } = stripHeartbeatToken(text);
  if (!hadToken) return false;
  return stripped.length <= ackMaxChars;
}
