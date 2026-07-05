import type { Config } from '../../config/schema.js';

export const STARTUP_CONTEXT_MARKER = '[Startup context loaded by runtime]';
const STARTUP_CONTEXT_TRUNCATED = '...[additional startup memory truncated]...';
const STARTUP_QUOTED_CONTEXT_END = 'END_QUOTED_NOTES';

export function shouldApplyStartupContext(params: {
  cfg?: Config;
  action: 'new' | 'reset';
}): boolean {
  void params;
  return false;
}

export function buildSessionStartupContextPrelude(params: {
  workspaceDir: string;
  cfg?: Config;
  nowMs?: number;
  userTimezone?: string;
}): string | null {
  void params;
  return null;
}

/** Strip runtime startup prelude from persisted user text (titles, previews). */
export function stripSessionStartupContextFromUserText(text: string): string {
  if (!text.includes(STARTUP_CONTEXT_MARKER)) {
    return text;
  }
  const trimmed = text.replace(/^\uFEFF/, '');
  if (!trimmed.startsWith(STARTUP_CONTEXT_MARKER)) {
    return text;
  }

  let cutIndex = -1;
  const lastEndNotes = trimmed.lastIndexOf(STARTUP_QUOTED_CONTEXT_END);
  if (lastEndNotes >= 0) {
    cutIndex = lastEndNotes + STARTUP_QUOTED_CONTEXT_END.length;
  } else {
    const truncIdx = trimmed.indexOf(STARTUP_CONTEXT_TRUNCATED);
    if (truncIdx >= 0) {
      cutIndex = truncIdx + STARTUP_CONTEXT_TRUNCATED.length;
    }
  }

  if (cutIndex < 0) {
    const afterMarker = trimmed.slice(STARTUP_CONTEXT_MARKER.length);
    const doubleNewline = afterMarker.indexOf('\n\n');
    if (doubleNewline >= 0) {
      return afterMarker.slice(doubleNewline + 2).replace(/^\s+/, '');
    }
    return text;
  }

  return trimmed.slice(cutIndex).replace(/^\s+/, '');
}
