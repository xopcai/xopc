import * as Haptics from 'expo-haptics';

export function hapticAskAiPress(): void {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}

export function hapticAskAiSettle(): void {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft);
}

export function hapticAskAiDismiss(): void {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}

/** Entering list multi-select mode */
export function hapticSelectionEnter(): void {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}

/** A verified workspace change, not the initial row tap. */
export function hapticGatewaySwitchSuccess(): void {
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
}

export function hapticVoiceStart(): void {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}

export function hapticVoiceZoneChange(): void {
  void Haptics.selectionAsync();
}

export function hapticVoiceSend(): void {
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
}

export function hapticVoiceCancel(): void {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft);
}
