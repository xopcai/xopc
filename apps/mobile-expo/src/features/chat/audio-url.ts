import { useGatewayStore } from '../../stores/gateway-store';
import type { AudioContent } from './messages.types';
import { buildGatewayMediaReadPath, isMediaUri } from './media-uri';
import { workspaceRelativePathToApiPath } from './workspace-file-url';

export function buildGatewayAudioPath(
  workspaceRelativePath: string,
  sessionKey?: string | null,
): string {
  if (isMediaUri(workspaceRelativePath)) {
    return buildGatewayMediaReadPath(workspaceRelativePath, sessionKey);
  }
  return workspaceRelativePathToApiPath(workspaceRelativePath.replace(/^\/+/, ''), { sessionKey });
}

export function buildGatewayAudioUrl(
  workspaceRelativePath: string,
  sessionKey?: string | null,
): string {
  return useGatewayStore.getState().apiUrl(buildGatewayAudioPath(workspaceRelativePath, sessionKey));
}

export function resolveAudioPlaybackUrl(audio: AudioContent, sessionKey?: string | null): string {
  const uri = audio.uri?.trim();
  if (uri) {
    if (isMediaUri(uri)) return useGatewayStore.getState().apiUrl(buildGatewayMediaReadPath(uri, sessionKey));
    return uri;
  }
  const path = audio.workspaceRelativePath?.trim();
  if (!path) return '';
  return buildGatewayAudioUrl(path, sessionKey);
}

export function audioNameFromPath(path: string | undefined, fallback = 'voice.mp3'): string {
  const name = path?.split('/').filter(Boolean).pop()?.trim();
  return name || fallback;
}
