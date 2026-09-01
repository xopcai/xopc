import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Icon } from 'react-native-paper';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { useMessages } from '../../i18n/messages';
import { useReducedMotion } from '../../motion/use-reduced-motion';
import { radii, spacing, typography, useTheme } from '../../theme';
import type { ComposerAttachment } from './composer.types';
import {
  coverImageSize,
  cropRectForTransform,
  fitCropFrame,
  type ImageSize,
} from './image-editor-math';
import { cropImageAttachment, rotateImageForEditing } from './image-editing';

type AspectMode = 'original' | 'square' | 'fourThree' | 'sixteenNine';
type EditorSource = ImageSize & { uri: string };

const MAX_ZOOM = 4;

function imageSize(uri: string): Promise<ImageSize> {
  return new Promise((resolve, reject) => {
    Image.getSize(uri, (width, height) => resolve({ width, height }), reject);
  });
}

function aspectForMode(mode: AspectMode, source: EditorSource | null): number {
  if (mode === 'square') return 1;
  if (mode === 'fourThree') return 4 / 3;
  if (mode === 'sixteenNine') return 16 / 9;
  return source ? source.width / source.height : 1;
}

function clampOnUi(value: number, min: number, max: number): number {
  'worklet';
  return Math.min(max, Math.max(min, value));
}

export function ImageEditorModal({
  visible,
  attachment,
  onClose,
  onSave,
}: {
  visible: boolean;
  attachment: ComposerAttachment | null;
  onClose: () => void;
  onSave: (attachment: ComposerAttachment) => void;
}) {
  const m = useMessages();
  const { colors } = useTheme();
  const reducedMotion = useReducedMotion();
  const [source, setSource] = useState<EditorSource | null>(null);
  const [originalSource, setOriginalSource] = useState<EditorSource | null>(null);
  const [stage, setStage] = useState<ImageSize>({ width: 0, height: 0 });
  const [aspectMode, setAspectMode] = useState<AspectMode>('original');
  const [rotation, setRotation] = useState(0);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');

  const zoom = useSharedValue(1);
  const offsetX = useSharedValue(0);
  const offsetY = useSharedValue(0);
  const panStartX = useSharedValue(0);
  const panStartY = useSharedValue(0);
  const pinchStart = useSharedValue(1);

  useEffect(() => {
    if (!visible || !attachment?.localUri) return;
    let active = true;
    setSource(null);
    setOriginalSource(null);
    setAspectMode('original');
    setRotation(0);
    setDirty(false);
    setError('');
    void imageSize(attachment.localUri)
      .then((size) => {
        if (!active) return;
        const initialSource = { uri: attachment.localUri!, ...size };
        setSource(initialSource);
        setOriginalSource(initialSource);
      })
      .catch(() => {
        if (active) setError(m.chat.imageEditorLoadFailed);
      });
    return () => {
      active = false;
    };
  }, [attachment, m.chat.imageEditorLoadFailed, visible]);

  const aspect = aspectForMode(aspectMode, source);
  const frame = useMemo(() => fitCropFrame(stage, aspect), [aspect, stage]);
  const baseImage = useMemo(
    () => source ? coverImageSize(source, frame) : { width: 0, height: 0 },
    [frame, source],
  );

  useEffect(() => {
    zoom.value = 1;
    offsetX.value = 0;
    offsetY.value = 0;
  }, [baseImage.height, baseImage.width, offsetX, offsetY, zoom]);

  const markDirty = useCallback(() => setDirty(true), []);
  const gesture = useMemo(() => {
    const pan = Gesture.Pan()
      .enabled(Boolean(source) && !busy)
      .onBegin(() => {
        panStartX.value = offsetX.value;
        panStartY.value = offsetY.value;
      })
      .onUpdate((event) => {
        const maxX = Math.max(0, (baseImage.width * zoom.value - frame.width) / 2);
        const maxY = Math.max(0, (baseImage.height * zoom.value - frame.height) / 2);
        offsetX.value = clampOnUi(panStartX.value + event.translationX, -maxX, maxX);
        offsetY.value = clampOnUi(panStartY.value + event.translationY, -maxY, maxY);
      })
      .onEnd((event) => {
        if (Math.abs(event.translationX) > 0.5 || Math.abs(event.translationY) > 0.5) {
          scheduleOnRN(markDirty);
        }
      });

    const pinch = Gesture.Pinch()
      .enabled(Boolean(source) && !busy)
      .onBegin(() => {
        pinchStart.value = zoom.value;
      })
      .onUpdate((event) => {
        const nextZoom = clampOnUi(pinchStart.value * event.scale, 1, MAX_ZOOM);
        const maxX = Math.max(0, (baseImage.width * nextZoom - frame.width) / 2);
        const maxY = Math.max(0, (baseImage.height * nextZoom - frame.height) / 2);
        zoom.value = nextZoom;
        offsetX.value = clampOnUi(offsetX.value, -maxX, maxX);
        offsetY.value = clampOnUi(offsetY.value, -maxY, maxY);
      })
      .onEnd((event) => {
        if (Math.abs(event.scale - 1) > 0.001) scheduleOnRN(markDirty);
      });

    return Gesture.Simultaneous(pan, pinch);
  }, [baseImage, busy, frame, markDirty, offsetX, offsetY, panStartX, panStartY, pinchStart, source, zoom]);

  const imagePositionStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: offsetX.value },
      { translateY: offsetY.value },
    ],
  }));
  const imageZoomStyle = useAnimatedStyle(() => ({
    transform: [{ scale: zoom.value }],
  }));

  const handleStageLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setStage({ width, height });
  }, []);

  const handleAspect = useCallback((mode: AspectMode) => {
    if (mode === aspectMode) return;
    setAspectMode(mode);
    setDirty(true);
  }, [aspectMode]);

  const handleRotate = useCallback(async () => {
    if (!source || !originalSource || !attachment || busy) return;
    setBusy(true);
    setError('');
    try {
      const nextRotation = (rotation + 90) % 360;
      if (nextRotation === 0) {
        setSource(originalSource);
      } else {
        const rotated = await rotateImageForEditing(originalSource.uri, attachment.mimeType, nextRotation);
        setSource({ uri: rotated.uri, width: rotated.width, height: rotated.height });
      }
      setRotation(nextRotation);
      setDirty(true);
    } catch {
      setError(m.chat.imageEditorSaveFailed);
    } finally {
      setBusy(false);
    }
  }, [attachment, busy, m.chat.imageEditorSaveFailed, originalSource, rotation, source]);

  const handleDone = useCallback(async () => {
    if (!source || !originalSource || !attachment || busy || !frame.width || !frame.height) return;
    if (!dirty) {
      onClose();
      return;
    }
    setBusy(true);
    setError('');
    try {
      const crop = cropRectForTransform(source, frame, {
        zoom: zoom.value,
        offsetX: offsetX.value,
        offsetY: offsetY.value,
      });
      onSave(await cropImageAttachment(attachment, originalSource.uri, crop, rotation));
    } catch {
      setError(m.chat.imageEditorSaveFailed);
    } finally {
      setBusy(false);
    }
  }, [attachment, busy, dirty, frame, m.chat.imageEditorSaveFailed, offsetX, offsetY, onClose, onSave, originalSource, rotation, source, zoom]);

  const aspectOptions: Array<{ mode: AspectMode; label: string }> = [
    { mode: 'original', label: m.chat.imageEditorOriginal },
    { mode: 'square', label: '1:1' },
    { mode: 'fourThree', label: '4:3' },
    { mode: 'sixteenNine', label: '16:9' },
  ];

  return (
    <Modal
      visible={visible}
      animationType={reducedMotion ? 'none' : 'slide'}
      presentationStyle="fullScreen"
      onRequestClose={() => {
        if (!busy) onClose();
      }}
    >
      <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.surface.base }]}>
        <View style={[styles.header, { borderBottomColor: colors.border.subtle }]}>
          <Pressable
            style={styles.headerAction}
            onPress={onClose}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={m.common.cancel}
          >
            <Text style={[styles.headerActionText, { color: colors.text.secondary }]}>{m.common.cancel}</Text>
          </Pressable>
          <Text style={[styles.title, { color: colors.text.primary }]}>{m.chat.imageEditorTitle}</Text>
          <Pressable
            style={styles.headerAction}
            onPress={() => void handleDone()}
            disabled={busy || !source}
            accessibilityRole="button"
            accessibilityLabel={m.chat.imageEditorDone}
          >
            <Text style={[styles.headerActionText, { color: colors.accent.primary }]}>{m.chat.imageEditorDone}</Text>
          </Pressable>
        </View>

        <View style={styles.stage} onLayout={handleStageLayout}>
          {source && frame.width && frame.height ? (
            <GestureDetector gesture={gesture}>
              <View
                style={[
                  styles.cropFrame,
                  {
                    width: frame.width,
                    height: frame.height,
                    borderColor: colors.accent.onPrimary,
                    backgroundColor: colors.surface.grouped,
                  },
                ]}
              >
                <Animated.View
                  style={[
                    styles.editImage,
                    {
                      width: baseImage.width,
                      height: baseImage.height,
                      left: (frame.width - baseImage.width) / 2,
                      top: (frame.height - baseImage.height) / 2,
                    },
                    imagePositionStyle,
                  ]}
                >
                  <Animated.Image
                    source={{ uri: source.uri }}
                    style={[styles.editImageContent, imageZoomStyle]}
                    resizeMode="cover"
                  />
                </Animated.View>
                <View pointerEvents="none" style={styles.grid}>
                  <View style={[styles.gridVertical, styles.gridVerticalOneThird, { backgroundColor: colors.accent.onPrimary }]} />
                  <View style={[styles.gridVertical, styles.gridVerticalTwoThirds, { backgroundColor: colors.accent.onPrimary }]} />
                  <View style={[styles.gridHorizontal, styles.gridHorizontalOneThird, { backgroundColor: colors.accent.onPrimary }]} />
                  <View style={[styles.gridHorizontal, styles.gridHorizontalTwoThirds, { backgroundColor: colors.accent.onPrimary }]} />
                </View>
              </View>
            </GestureDetector>
          ) : error ? (
            <Text style={[styles.error, { color: colors.semantic.error }]}>{error}</Text>
          ) : (
            <ActivityIndicator color={colors.accent.primary} />
          )}
        </View>

        <View style={[styles.controls, { borderTopColor: colors.border.subtle }]}>
          <Text style={[styles.hint, { color: colors.text.secondary }]}>{m.chat.imageEditorHint}</Text>
          {error && source ? <Text style={[styles.error, { color: colors.semantic.error }]}>{error}</Text> : null}
          <View style={styles.controlRow}>
            <Pressable
              style={({ pressed }) => [
                styles.rotateButton,
                {
                  borderColor: colors.border.default,
                  backgroundColor: pressed ? colors.surface.pressed : colors.surface.panel,
                },
              ]}
              onPress={() => void handleRotate()}
              disabled={busy || !source}
              accessibilityRole="button"
              accessibilityLabel={m.chat.imageEditorRotate}
            >
              <Icon source="rotate-right" size={20} color={colors.text.primary} />
            </Pressable>
            <View style={styles.aspectRow}>
              {aspectOptions.map((option) => {
                const active = option.mode === aspectMode;
                return (
                  <Pressable
                    key={option.mode}
                    style={({ pressed }) => [
                      styles.aspectButton,
                      {
                        borderColor: active ? colors.accent.primary : colors.border.default,
                        backgroundColor: active
                          ? colors.accent.soft
                          : pressed ? colors.surface.pressed : colors.surface.panel,
                      },
                    ]}
                    onPress={() => handleAspect(option.mode)}
                    disabled={busy || !source}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                  >
                    <Text style={[styles.aspectText, { color: active ? colors.accent.primary : colors.text.secondary }]}>
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>

        {busy ? (
          <View style={[styles.busyOverlay, { backgroundColor: colors.overlay.scrim }]} pointerEvents="auto">
            <View style={[styles.busyCard, { backgroundColor: colors.surface.elevated }]}>
              <ActivityIndicator color={colors.accent.primary} />
              <Text style={[styles.busyText, { color: colors.text.primary }]}>{m.chat.imageEditorProcessing}</Text>
            </View>
          </View>
        ) : null}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  header: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.sm,
  },
  headerAction: {
    minWidth: 72,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerActionText: typography.ui,
  title: typography.heading,
  stage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  cropFrame: {
    overflow: 'hidden',
    borderWidth: 1,
  },
  editImage: {
    position: 'absolute',
  },
  editImageContent: {
    width: '100%',
    height: '100%',
  },
  grid: {
    position: 'absolute',
    inset: 0,
    opacity: 0.38,
  },
  gridVertical: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: StyleSheet.hairlineWidth,
  },
  gridHorizontal: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
  },
  gridVerticalOneThird: {
    left: '33.333%',
  },
  gridVerticalTwoThirds: {
    left: '66.666%',
  },
  gridHorizontalOneThird: {
    top: '33.333%',
  },
  gridHorizontalTwoThirds: {
    top: '66.666%',
  },
  controls: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    gap: spacing.sm,
  },
  hint: {
    ...typography.caption,
    textAlign: 'center',
  },
  error: {
    ...typography.label,
    textAlign: 'center',
  },
  controlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  rotateButton: {
    width: 44,
    height: 44,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aspectRow: {
    flex: 1,
    flexDirection: 'row',
    gap: spacing.xs,
  },
  aspectButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  aspectText: typography.caption,
  busyOverlay: {
    position: 'absolute',
    inset: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  busyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  busyText: typography.ui,
});
