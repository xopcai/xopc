/** Media store bucket — maps to `{stateDir}/media/<bucket>/`. */
export type MediaBucket = 'inbound' | 'tts' | 'outbound';

/** Persisted media reference — never includes base64. */
export interface MediaRef {
  id: string;
  bucket: MediaBucket;
  type: string;
  mimeType: string;
  name: string;
  size: number;
  /** Canonical URI, e.g. `media://inbound/photo---uuid.png`. */
  uri: string;
  /** Absolute filesystem path (for MediaPaths transcript fields). */
  path: string;
}

export type SavedMedia = {
  id: string;
  path: string;
  size: number;
  contentType: string;
  bucket: MediaBucket;
  uri: string;
};

/** Wire / pre-persist attachment (may include base64 `data`). */
export interface InboundAttachmentInput {
  id?: string;
  type: string;
  mimeType?: string;
  data?: string;
  name?: string;
  size?: number;
  /** Already persisted — pass-through by URI. */
  uri?: string;
}
