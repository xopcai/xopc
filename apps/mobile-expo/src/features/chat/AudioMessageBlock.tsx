import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import type { AudioPlayer } from 'expo-audio';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';

import { useMessages } from '../../i18n/messages';
import { useGatewayStore } from '../../stores/gateway-store';
import { useTheme } from '../../theme';
import type { AudioContent } from './messages.types';
import { audioNameFromPath, resolveAudioPlaybackUrl } from './audio-url';

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0:00';
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export const AudioMessageBlock = memo(function AudioMessageBlock({
  audio,
  sessionKey,
  align = 'start',
}: {
  audio: AudioContent;
  sessionKey?: string | null;
  /** User bubbles pass `end` so the bar hugs the right edge like web chat. */
  align?: 'start' | 'end';
}) {
  const { colors } = useTheme();
  const m = useMessages();
  const token = useGatewayStore((s) => s.token);
  const playerRef = useRef<AudioPlayer | null>(null);
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [positionMillis, setPositionMillis] = useState(0);
  const [durationMillis, setDurationMillis] = useState((audio.durationSeconds ?? 0) * 1000);
  const [error, setError] = useState<string | null>(null);

  const uri = useMemo(() => resolveAudioPlaybackUrl(audio, sessionKey), [audio, sessionKey]);

  const title = audio.name?.trim() || audioNameFromPath(audio.workspaceRelativePath ?? audio.uri, 'voice.mp3');

  const unload = useCallback(() => {
    const player = playerRef.current;
    playerRef.current = null;
    if (!player) return;
    try {
      player.remove();
    } catch {
      // Ignore unload races when the component unmounts or source changes.
    }
  }, []);

  useEffect(() => {
    return () => {
      unload();
    };
  }, [unload]);

  useEffect(() => {
    unload();
    setPlaying(false);
    setPositionMillis(0);
    setDurationMillis((audio.durationSeconds ?? 0) * 1000);
    setError(null);
  }, [audio.durationSeconds, unload, uri]);

  const ensurePlayer = useCallback(async () => {
    if (playerRef.current) return playerRef.current;
    if (!uri) throw new Error(m.chat.audioMissingSource);

    await setAudioModeAsync({
      allowsRecording: false,
      playsInSilentMode: true,
    });

    const source = {
      uri,
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    };
    const player = createAudioPlayer(source, { updateInterval: 250 });
    player.addListener('playbackStatusUpdate', (status) => {
      if (!status.isLoaded) {
        setPlaying(false);
        return;
      }
      setPlaying(status.playing);
      setPositionMillis(Math.round((status.currentTime ?? 0) * 1000));
      setDurationMillis(Math.round((status.duration ?? 0) * 1000) || durationMillis);
      if (status.didJustFinish) {
        setPlaying(false);
        void player.seekTo(0).catch(() => {});
      }
    });
    playerRef.current = player;
    return player;
  }, [durationMillis, m.chat.audioMissingSource, token, uri]);

  const toggle = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const player = await ensurePlayer();
      if (player.playing) {
        player.pause();
      } else {
        player.play();
      }
    } catch {
      setError(m.chat.audioPlaybackFailed);
      setPlaying(false);
    } finally {
      setLoading(false);
    }
  }, [ensurePlayer, loading, m.chat.audioPlaybackFailed]);

  const progress = durationMillis > 0 ? Math.min(1, Math.max(0, positionMillis / durationMillis)) : 0;
  const border = colors.border.default;
  const bg = colors.surface.input;
  const text = colors.text.primary;
  const muted = colors.text.secondary;
  const accent = colors.accent.primary;

  return (
    <View
      style={[
        styles.card,
        align === 'end' ? styles.cardAlignEnd : styles.cardAlignStart,
        { borderColor: border, backgroundColor: bg },
      ]}
    >
      <Pressable
        style={[styles.playButton, { backgroundColor: accent }]}
        onPress={toggle}
        accessibilityRole="button"
        accessibilityLabel={playing ? m.chat.audioPause : m.chat.audioPlay}
      >
        <Icon source={loading ? 'loading' : playing ? 'pause' : 'play'} size={18} color={colors.accent.onPrimary} />
      </Pressable>
      <View style={styles.body}>
        <Text style={[styles.title, { color: text }]} numberOfLines={1}>{title}</Text>
        <View style={[styles.progressTrack, { backgroundColor: colors.border.default }]}>
          <View style={[styles.progressFill, { width: `${progress * 100}%`, backgroundColor: accent }]} />
        </View>
        <Text style={[styles.meta, { color: error ? colors.semantic.errorBold : muted }]} numberOfLines={1}>
          {error ?? `${formatDuration(positionMillis)} / ${formatDuration(durationMillis)}`}
        </Text>
      </View>
    </View>
  );
});

/** Match web `VoiceMessageBar` shell width (min 160px, max 17rem ≈ 272px). */
const VOICE_BAR_MIN_WIDTH = 220;
const VOICE_BAR_MAX_WIDTH = 272;

const styles = StyleSheet.create({
  card: {
    marginTop: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minWidth: VOICE_BAR_MIN_WIDTH,
    maxWidth: VOICE_BAR_MAX_WIDTH,
  },
  cardAlignStart: {
    alignSelf: 'flex-start',
  },
  cardAlignEnd: {
    alignSelf: 'flex-end',
  },
  playButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  body: {
    flex: 1,
    minWidth: 0,
    gap: 5,
  },
  title: {
    fontSize: 13,
    fontWeight: '600',
  },
  progressTrack: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
  },
  meta: {
    fontSize: 11,
  },
});
