import type { ImperativeRouter } from 'expo-router';

/**
 * After gateway credentials are saved, return to the workspace home.
 */
export async function navigateHomeAfterGatewayConnect(
  replace: ImperativeRouter['replace'],
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    replace('/');
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
