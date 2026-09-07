import type { PropsWithChildren } from 'react';
import { Modal, Platform, StyleSheet, View } from 'react-native';
import { Portal } from 'react-native-paper';
import { FullWindowOverlay } from 'react-native-screens';

type Props = PropsWithChildren<{ expanded: boolean; onClose: () => void }>;

export function VoiceCallOverlay({ expanded, onClose, children }: Props) {
  if (Platform.OS === 'ios') {
    // A root Modal cannot present over an already presented native-stack screen.
    return <FullWindowOverlay unstable_accessibilityContainerViewIsModal={expanded}>
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none" accessibilityViewIsModal={expanded}>
        {children}
      </View>
    </FullWindowOverlay>;
  }
  return expanded
    ? <Modal visible animationType="slide" onRequestClose={onClose}>{children}</Modal>
    : <Portal>{children}</Portal>;
}
