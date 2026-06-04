/** Default reset triggers (OpenClaw-aligned). */
export const DEFAULT_RESET_TRIGGERS = ['/new', '/reset'] as const;

export type ResetTriggerMatch = {
  resetTriggered: boolean;
  bodyStripped: string;
  matchedTrigger?: string;
  bareReset: boolean;
};

/** Strip gateway/channel envelope prefix e.g. `[Jun 4 17:35] `. */
export function stripLeadingEnvelopeTimestamp(body: string): string {
  return body.replace(/^\[[^\]]+\]\s*/, '');
}

/**
 * Match configured reset triggers against inbound body (case-insensitive trigger,
 * preserve tail casing). Mirrors OpenClaw `initSessionState` reset-trigger loop.
 */
export function matchResetTriggers(body: string, triggers: readonly string[]): ResetTriggerMatch {
  const normalized = stripLeadingEnvelopeTimestamp(body.trim());
  const lower = normalized.toLowerCase();

  for (const trigger of triggers) {
    const trimmedTrigger = trigger.trim();
    if (!trimmedTrigger) {
      continue;
    }
    const triggerLower = trimmedTrigger.toLowerCase();

    if (lower === triggerLower) {
      return {
        resetTriggered: true,
        bodyStripped: '',
        matchedTrigger: trimmedTrigger,
        bareReset: true,
      };
    }

    const prefix = `${triggerLower} `;
    if (lower.startsWith(prefix)) {
      const rest = normalized.slice(trimmedTrigger.length).trimStart();
      return {
        resetTriggered: true,
        bodyStripped: rest,
        matchedTrigger: trimmedTrigger,
        bareReset: rest.length === 0,
      };
    }
  }

  return {
    resetTriggered: false,
    bodyStripped: body,
    bareReset: false,
  };
}

export function resolveResetTriggers(
  configured?: string[],
): readonly string[] {
  if (configured?.length) {
    return configured;
  }
  return DEFAULT_RESET_TRIGGERS;
}

export function bareResetAckMessage(matchedTrigger?: string): string {
  const lower = (matchedTrigger ?? '').toLowerCase();
  if (lower.includes('reset')) {
    return '✅ Session reset.';
  }
  return '✅ New session started.';
}

/** Slash command names that overlap reset triggers — skip when init already reset. */
export const RESET_OVERLAP_COMMANDS = new Set(['new', 'reset', 'restart']);

export function shouldSkipResetOverlapCommand(
  command: string | undefined,
  resetTriggered: boolean,
): boolean {
  if (!resetTriggered || !command) {
    return false;
  }
  return RESET_OVERLAP_COMMANDS.has(command.toLowerCase());
}
