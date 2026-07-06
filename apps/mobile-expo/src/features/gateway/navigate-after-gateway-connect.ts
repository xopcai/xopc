import type { ImperativeRouter } from 'expo-router';

import { chatRoute } from '../../lib/navigation';
import { createSession } from '../../query/sessions';

/**
 * After gateway credentials are saved, open a fresh chat session.
 */
export async function openDefaultSessionAfterConnect(
  replace: ImperativeRouter['replace'],
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const key = await createSession(undefined);
    replace(chatRoute(key));
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
