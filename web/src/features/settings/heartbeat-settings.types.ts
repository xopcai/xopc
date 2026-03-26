export interface HeartbeatActiveHoursForm {
  start: string;
  end: string;
  timezone: string;
}

export interface HeartbeatSettingsState {
  enabled: boolean;
  intervalMs: number;
  target: string;
  targetChatId: string;
  prompt: string;
  ackMaxChars: number | '';
  isolatedSession: boolean;
  activeHours: HeartbeatActiveHoursForm | null;
}
