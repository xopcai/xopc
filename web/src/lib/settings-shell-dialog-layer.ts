/** Viewport under 1200px: settings shell portals to `document.body` (full-screen). */
export const SETTINGS_SHEET_PORTAL_BODY_MQ = '(max-width: 1199px)';

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

/** Popovers/menus opened from controls inside a settings-shell modal (`CONTENT` is z-[76]). */
export const SETTINGS_SHELL_MODAL_POPOVER_Z = 'z-[77]';

/**
 * Body-portaled interactive surfaces must clear every app dialog layer. Keep this below
 * the emergency tooltip tier (`z-[10000]`) while remaining above the highest dialog.
 */
export const APP_PORTALED_POPOVER_Z = 'z-[300]';
