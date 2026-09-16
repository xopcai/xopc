import { apiFetch, formatApiHttpError } from '../api/client';

export type UserProfileSummary = {
  callName: string;
  role: string;
  suggestedCallName?: string;
};

export async function fetchUserProfileSummary(): Promise<UserProfileSummary> {
  const response = await apiFetch('/api/user-model');
  const body = await response.json().catch(() => null) as {
    profile?: { callName?: unknown; role?: unknown };
    suggestedCallName?: unknown;
    error?: { message?: string };
  } | null;
  if (!response.ok) {
    throw new Error(formatApiHttpError(response.status, response.statusText, body?.error?.message));
  }
  return {
    callName: typeof body?.profile?.callName === 'string' ? body.profile.callName.trim() : '',
    role: typeof body?.profile?.role === 'string' ? body.profile.role.trim() : '',
    ...(typeof body?.suggestedCallName === 'string' && body.suggestedCallName.trim()
      ? { suggestedCallName: body.suggestedCallName.trim() }
      : {}),
  };
}
