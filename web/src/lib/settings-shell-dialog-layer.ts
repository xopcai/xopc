/**
 * When the settings shell is portaled to `document.body` (viewport under 1200px), it sits
 * above app chrome such as the mobile sidebar (`z-50`). Nested Radix surfaces must clear
 * this root.
 */
export const SETTINGS_SHEET_PORTAL_Z = 'z-[58]';

/**
 * Z-index for Radix dialogs/drawers opened from routes wrapped in `SettingsSheet`.
 * The sheet uses z-40 (scrim) and z-50 (panel) inside its stacking context; portaled UI
 * must sit above the portaled shell root.
 */
export const SETTINGS_SHELL_OVERLAY_Z = 'z-[75]';
export const SETTINGS_SHELL_CONTENT_Z = 'z-[76]';

/** Popovers/menus portaled above the settings panel but below modal tier. */
export const SETTINGS_SHELL_POPOVER_Z = 'z-[74]';
