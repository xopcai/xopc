export interface XopcMusicTrack {
  id: string;
  conversationId: string;
  title: string;
  sourceTitle: string;
  lyrics?: string;
  durationMs?: number;
  versionNumber?: number;
}

export interface XopcMusicResume {
  gatewayId: string;
  track: XopcMusicTrack;
  position: number;
}

export const MUSIC_OPEN_URI: string = 'xopc://music/player';
