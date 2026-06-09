import { useGatewayStore } from '@/stores/gateway-store';

import { buildNoteAttachmentRef, isNoteAttachmentTarget } from './attachment-ref';

export {
  buildNoteAttachmentRef,
  isNoteAttachmentTarget,
  noteMediaApiPath,
  parseNoteAttachmentTarget,
} from './attachment-ref';

/** Canonical URI persisted in note markdown. */
export function noteAttachmentRef(noteId: string, attachmentId: string): string {
  return buildNoteAttachmentRef(noteId, attachmentId);
}

/** Human-readable label for voice memo markdown links. */
export function formatVoiceMemoLabel(durationSec: number): string {
  if (durationSec < 60) return `Voice · ${durationSec}s`;
  const minutes = Math.floor(durationSec / 60);
  const seconds = durationSec % 60;
  return `Voice · ${minutes}:${String(seconds).padStart(2, '0')}`;
}

async function readFormError(res: Response): Promise<string> {
  const data = (await res.json().catch(() => ({}))) as { error?: unknown };
  if (typeof data.error === 'string') return data.error;
  return `HTTP ${res.status}`;
}

/** POST multipart/form-data with Bearer auth (no JSON Content-Type). */
export async function postNoteFormData<T>(url: string, form: FormData): Promise<T> {
  const token = useGatewayStore.getState().token;
  const headers = new Headers();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(url, { method: 'POST', headers, body: form });

  if (res.status === 401) {
    useGatewayStore.getState().onUnauthorized();
  }

  if (!res.ok) {
    throw new Error(await readFormError(res));
  }

  return res.json() as Promise<T>;
}

export { isNoteAttachmentTarget as isNoteMediaRef };
