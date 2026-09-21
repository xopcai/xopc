import type { ConnectorsSettingsMessages } from '@/i18n/messages';

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function formatComposioError(error: unknown, t: ConnectorsSettingsMessages): string {
  const message = errorText(error);
  if (
    /APIKey_InsufficientPermissions/i.test(message)
    || /["\\]?code["\\]?\s*:\s*812\b/i.test(message)
    || (/session_management/i.test(message) && /write access|write permission|at least ["\\]?write/i.test(message))
  ) {
    return t.composioSessionWritePermissionRequired;
  }
  return message;
}
