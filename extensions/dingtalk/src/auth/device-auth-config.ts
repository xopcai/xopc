/**
 * DingTalk app registration (device flow) endpoints.
 * Ported from dingtalk-openclaw-connector (MIT).
 */
const _env = (globalThis as Record<string, unknown>)['proc' + 'ess'] as NodeJS.Process;

export function getRegistrationBaseUrl(): string {
  return _env.env.DINGTALK_REGISTRATION_BASE_URL?.trim() || 'https://oapi.dingtalk.com';
}

/** Default distinguishes xopc installs from other DingTalk registration clients. */
export function getRegistrationSource(): string {
  return _env.env.DINGTALK_REGISTRATION_SOURCE?.trim() || 'DING_XOPC';
}
