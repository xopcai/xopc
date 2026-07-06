import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { radii, spacing, typography, useTheme } from '../theme';

export type BottomSheetModalProps = {
  visible: boolean;
  onDismiss: () => void;
  title?: string;
  subtitle?: string;
  headerAction?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  maxHeight?: `${number}%` | number;
  scroll?: boolean;
  keyboardAvoiding?: boolean;
  testID?: string;
};

export function BottomSheetModal({
  visible,
  onDismiss,
  title,
  subtitle,
  headerAction,
  children,
  footer,
  maxHeight = '70%',
  scroll = false,
  keyboardAvoiding = false,
  testID,
}: BottomSheetModalProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  if (!visible) return null;

  const content = (
    <View style={styles.overlay}>
      <Pressable
        style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay.scrim }]}
        onPress={onDismiss}
      />
      <Pressable
        testID={testID}
        style={[
          styles.sheet,
          {
            backgroundColor: colors.surface.panel,
            maxHeight,
            paddingBottom: Math.max(insets.bottom, spacing.xl),
          },
        ]}
        onPress={(event) => event.stopPropagation()}
      >
        <View style={[styles.handle, { backgroundColor: colors.border.strong }]} />
        {title ? (
          <View style={styles.headerRow}>
            <View style={styles.headerText}>
              <Text style={[styles.title, { color: colors.text.primary }]}>{title}</Text>
              {subtitle ? (
                <Text style={[styles.subtitle, { color: colors.text.tertiary }]}>{subtitle}</Text>
              ) : null}
            </View>
            {headerAction}
          </View>
        ) : null}
        {scroll ? (
          <ScrollView
            style={styles.scrollArea}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            {children}
          </ScrollView>
        ) : (
          children
        )}
        {footer ? <View style={[styles.footer, { borderTopColor: colors.border.subtle }]}>{footer}</View> : null}
      </Pressable>
    </View>
  );

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onDismiss}>
      {keyboardAvoiding ? (
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          {content}
        </KeyboardAvoidingView>
      ) : content}
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    paddingTop: spacing.sm,
    overflow: 'hidden',
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: spacing.md,
    opacity: 0.7,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    marginBottom: spacing.sm,
  },
  headerText: {
    flex: 1,
    gap: spacing.xxs,
  },
  title: {
    ...typography.heading,
  },
  subtitle: {
    ...typography.caption,
  },
  scrollArea: {
    paddingHorizontal: spacing.md,
  },
  scrollContent: {
    paddingBottom: spacing.xs,
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
  },
});
