/** Shared spatial, radius, typography, and iconography tokens for HarmonyOS views. */
export const XOPC_PAGE_PADDING_X: number = 16;
export const XOPC_SHEET_PADDING_X: number = 20;
export const XOPC_CARD_PADDING: number = 16;
export const XOPC_CARD_PADDING_COMPACT: number = 14;
export const XOPC_ITEM_GAP: number = 8;
export const XOPC_GROUP_GAP: number = 12;
export const XOPC_SECTION_GAP: number = 24;

export const XOPC_RADIUS_XS: number = 8;
export const XOPC_RADIUS_SM: number = 12;
export const XOPC_RADIUS_MD: number = 16;
export const XOPC_RADIUS_LG: number = 20;
export const XOPC_RADIUS_PILL: number = 999;

export const XOPC_BUTTON_HEIGHT_SM: number = 36;
export const XOPC_BUTTON_HEIGHT_MD: number = 44;
export const XOPC_BUTTON_HEIGHT_LG: number = 48;

export const XOPC_ICON_HEADER: number = 20;
export const XOPC_ICON_ROW: number = 18;
export const XOPC_ICON_CHEVRON: number = 14;
export const XOPC_DISABLED_OPACITY: number = 0.42;

export function xopcBackIcon(): Resource {
  return $r('sys.symbol.arrow_left');
}

export function xopcMoreIcon(): Resource {
  return $r('sys.symbol.ellipsis_circle');
}

export function xopcCloseIcon(): Resource {
  return $r('sys.symbol.xmark');
}
