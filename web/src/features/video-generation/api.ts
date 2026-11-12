import type { VideoModelSettings } from '@xopcai/gateway-contract';
import useSWR, { mutate } from 'swr';

import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export const videoSettingsPath = '/api/video-generation/settings';

export function useVideoModelSettings(enabled = true) {
  return useSWR<VideoModelSettings>(enabled ? apiUrl(videoSettingsPath) : null, fetchJson<VideoModelSettings>);
}

export function revalidateVideoModelSettings() {
  return mutate(apiUrl(videoSettingsPath));
}
