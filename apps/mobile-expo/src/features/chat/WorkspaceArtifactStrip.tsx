import { useQuery } from '@tanstack/react-query';
import type { FileResource } from '@xopcai/gateway-contract';
import { useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';

import { t, useMessages } from '../../i18n/messages';
import { fileContentPath, resolveContextFileResources } from '../../query/files';
import { useGatewayStore } from '../../stores/gateway-store';
import { useTheme } from '../../theme';
import { FilePreviewModal, type PreviewableFile } from './FilePreviewModal';
import type { ExtractedFilePath } from './tool-result-file-paths';
import { isImageMimeType } from './tool-result-file-paths';

type ManagedArtifact = {
  source: ExtractedFilePath;
  resource: FileResource | null;
};

function artifactKey(path: ExtractedFilePath, index: number): string {
  return path.workspaceRelativePath?.trim() || path.absolutePath || `artifact-${index}`;
}

function toPreviewable(resource: FileResource): PreviewableFile {
  return {
    fileId: resource.id,
    name: resource.name,
    mimeType: resource.mimeType,
    workspaceRelativePath: resource.relativePath,
  };
}

export function WorkspaceArtifactStrip({
  paths,
  sessionKey,
}: {
  paths: ExtractedFilePath[];
  sessionKey?: string | null;
}) {
  const { colors } = useTheme();
  const m = useMessages();
  const apiUrl = useGatewayStore((state) => state.apiUrl);
  const token = useGatewayStore((state) => state.accessToken);
  const [active, setActive] = useState<PreviewableFile | null>(null);
  const relativePaths = useMemo(() => paths.map((path) => path.workspaceRelativePath), [paths]);
  const resolution = useQuery({
    queryKey: ['files', 'session-artifacts', sessionKey ?? '', relativePaths],
    queryFn: () => resolveContextFileResources('session', sessionKey!, relativePaths),
    enabled: Boolean(sessionKey && paths.length),
    staleTime: 30_000,
  });
  const artifacts = useMemo<ManagedArtifact[]>(
    () => paths.map((source, index) => ({ source, resource: resolution.data?.[index] ?? null })),
    [paths, resolution.data],
  );

  if (!paths.length) return null;

  const border = colors.border.default;
  const chipBg = colors.surface.input;
  const textColor = colors.text.primary;
  const muted = colors.text.secondary;
  const headers = token ? { Authorization: `Bearer ${token}` } : undefined;

  if (resolution.isLoading) {
    return (
      <View style={[styles.loadingChip, { backgroundColor: chipBg }]}>
        <View style={[styles.loadingIcon, { backgroundColor: border }]} />
        <View style={[styles.loadingText, { backgroundColor: border }]} />
      </View>
    );
  }

  return (
    <>
      <View style={styles.wrap}>
        {artifacts.map(({ source, resource }, index) => {
          if (resource && isImageMimeType(resource.mimeType)) {
            const preview = toPreviewable(resource);
            return (
              <Pressable
                key={artifactKey(source, index)}
                style={({ pressed }) => [styles.thumb, { borderColor: border }, pressed && styles.pressed]}
                onPress={() => setActive(preview)}
                accessibilityRole="button"
                accessibilityLabel={t(m.chat.previewFile, { name: resource.name })}
              >
                <Image
                  source={{ uri: apiUrl(fileContentPath(resource.id)), headers }}
                  style={styles.thumbImage}
                  resizeMode="cover"
                />
              </Pressable>
            );
          }

          const name = resource?.name || source.fileName;
          return (
            <Pressable
              key={artifactKey(source, index)}
              style={({ pressed }) => [
                styles.chip,
                { borderColor: border, backgroundColor: chipBg },
                pressed && resource && styles.pressed,
              ]}
              onPress={resource ? () => setActive(toPreviewable(resource)) : undefined}
              accessibilityRole={resource ? 'button' : undefined}
              accessibilityLabel={resource ? t(m.chat.previewFile, { name }) : undefined}
            >
              <Icon source={resource ? 'file-outline' : 'file-alert-outline'} size={16} color={muted} />
              <Text style={[styles.chipText, { color: textColor }]} numberOfLines={1}>{name}</Text>
              {resource ? <Icon source="eye-outline" size={14} color={muted} /> : null}
            </Pressable>
          );
        })}
      </View>
      <FilePreviewModal visible={Boolean(active)} file={active} onClose={() => setActive(null)} />
    </>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  loadingChip: {
    minHeight: 40,
    borderRadius: 10,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  loadingIcon: {
    width: 18,
    height: 18,
    borderRadius: 5,
    opacity: 0.55,
  },
  loadingText: {
    width: 112,
    height: 10,
    borderRadius: 5,
    opacity: 0.55,
  },
  thumb: {
    width: 80,
    height: 80,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    overflow: 'hidden',
  },
  thumbImage: {
    width: '100%',
    height: '100%',
  },
  chip: {
    maxWidth: '100%',
    minHeight: 36,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  chipText: {
    flexShrink: 1,
    fontSize: 12,
    fontWeight: '500',
  },
  pressed: {
    opacity: 0.72,
  },
});
