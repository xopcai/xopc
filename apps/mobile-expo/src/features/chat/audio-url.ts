import { useGatewayStore } from '../../stores/gateway-store';
import type { AudioContent } from './messages.types';
import { buildGatewayMediaReadPath, isMediaUri } from './media-uri';
export function resolveAudioPlaybackUrl(audio: AudioContent, sessionKey?: string | null): string {
  const uri = audio.uri?.trim();
  if (uri) {
    if (isMediaUri(uri)) return useGatewayStore.getState().apiUrl(buildGatewayMediaReadPath(uri, sessionKey));
    return uri;
  }
  return '';
}

export function audioNameFromPath(path: string | undefined, fallback = 'voice.mp3'): string {
  const name = path?.split('/').filter(Boolean).pop()?.trim();
  return name || fallback;
}
