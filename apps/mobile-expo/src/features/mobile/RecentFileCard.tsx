import type { FileResource } from '@xopcai/gateway-contract';
import { Pressable, StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';
import { GatewayImage } from '../../components/GatewayImage';
import { fileContentPath } from '../../query/files';
import { useGatewayStore } from '../../stores/gateway-store';
import { radii, spacing, typography, useTheme } from '../../theme';

export function RecentFileCard({ file, onPress }: { file: FileResource; onPress: () => void }) {
  const { colors } = useTheme();
  const apiUrl = useGatewayStore(state => state.apiUrl);
  const image = file.mimeType?.startsWith('image/');
  return <Pressable accessibilityRole="button" accessibilityLabel={file.name} onPress={onPress} style={({ pressed }) => [styles.card, { backgroundColor: pressed ? colors.surface.pressed : colors.surface.panel, borderColor: colors.border.subtle }]}>
    {image ? <GatewayImage source={{ uri: apiUrl(fileContentPath(file.id)) }} resizeMode="cover" style={[styles.preview, { backgroundColor: colors.surface.grouped }]} /> : null}
    <View style={styles.body}>
      <View style={[styles.icon, { backgroundColor: colors.accent.soft }]}><Icon source={image ? 'image-outline' : 'file-document-outline'} color={colors.accent.primary} size={24} /></View>
      <Text numberOfLines={2} style={[styles.title, { color: colors.text.primary }]}>{file.name}</Text>
      <Icon source="arrow-top-right" size={20} color={colors.text.secondary} />
    </View>
  </Pressable>;
}
const styles = StyleSheet.create({ card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.xl, overflow: 'hidden', marginBottom: spacing.md }, preview: { width: '100%', aspectRatio: 1.8 }, body: { padding: spacing.lg, flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 84 }, icon: { height: 44, width: 44, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center' }, title: { ...typography.heading, flex: 1 } });
