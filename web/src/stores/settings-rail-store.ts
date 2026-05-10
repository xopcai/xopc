import { create } from 'zustand';

const WIDTH_STORAGE_KEY = 'xopc-web-settings-rail-width-px';

/** Settings shell left rail: narrower range than main app sidebar (no full traffic-light chrome row). */
export const SETTINGS_RAIL_WIDTH_MIN = 192;
export const SETTINGS_RAIL_WIDTH_MAX = 360;
export const SETTINGS_RAIL_WIDTH_DEFAULT = 228;

function clampSettingsRailWidthPx(px: number): number {
  return Math.min(
    SETTINGS_RAIL_WIDTH_MAX,
    Math.max(SETTINGS_RAIL_WIDTH_MIN, Math.round(px)),
  );
}

function readSettingsRailWidthPx(): number {
  try {
    const raw = globalThis.localStorage?.getItem(WIDTH_STORAGE_KEY);
    if (raw == null) return clampSettingsRailWidthPx(SETTINGS_RAIL_WIDTH_DEFAULT);
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n)) return clampSettingsRailWidthPx(SETTINGS_RAIL_WIDTH_DEFAULT);
    return clampSettingsRailWidthPx(n);
  } catch {
    return clampSettingsRailWidthPx(SETTINGS_RAIL_WIDTH_DEFAULT);
  }
}

function writeSettingsRailWidthPx(px: number) {
  try {
    globalThis.localStorage?.setItem(WIDTH_STORAGE_KEY, String(px));
  } catch {
    /* ignore quota / private mode */
  }
}

type SettingsRailState = {
  widthPx: number;
  setWidthPx: (px: number) => void;
};

export const useSettingsRailStore = create<SettingsRailState>((set) => ({
  widthPx: readSettingsRailWidthPx(),
  setWidthPx: (px) => {
    const widthPx = clampSettingsRailWidthPx(px);
    set({ widthPx });
    queueMicrotask(() => writeSettingsRailWidthPx(widthPx));
  },
}));
