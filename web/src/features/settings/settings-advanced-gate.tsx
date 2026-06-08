import type { ReactNode } from 'react';

import { useShowAdvancedSettings } from '@/stores/settings-mode-store';

type Props = {
  children: ReactNode;
  /** Shown in simple mode when `children` are hidden. */
  fallback?: ReactNode;
};

/** Renders children only when advanced settings mode is on. */
export function SettingsAdvancedGate({ children, fallback = null }: Props) {
  const showAdvanced = useShowAdvancedSettings();
  return showAdvanced ? children : fallback;
}
