export type DesktopPetAnchor = {
  x: number;
  y: number;
};

export type DesktopPetWindowBounds = DesktopPetAnchor & {
  width: number;
  height: number;
};

export type DesktopPetContentSize = {
  width: number;
  height: number;
};

export function desktopPetDefaultAnchor(
  workArea: DesktopPetWindowBounds,
): DesktopPetAnchor {
  return {
    x: workArea.x + workArea.width,
    y: workArea.y + workArea.height,
  };
}

/** Keeps all visible pet content, including expanded bubbles, within the display. */
export function clampDesktopPetAnchor(
  anchor: DesktopPetAnchor,
  workArea: DesktopPetWindowBounds,
  contentWidth: number,
  contentHeight: number,
): DesktopPetAnchor {
  return {
    x: Math.min(
      Math.max(workArea.x + contentWidth, anchor.x),
      workArea.x + workArea.width,
    ),
    y: Math.min(
      Math.max(workArea.y + contentHeight, anchor.y),
      workArea.y + workArea.height,
    ),
  };
}

/** The pet is pinned to the window's bottom-right corner, so expansion grows up and left. */
export function desktopPetWindowBoundsForAnchor(
  anchor: DesktopPetAnchor,
  content: DesktopPetContentSize,
): DesktopPetWindowBounds {
  return {
    x: Math.round(anchor.x - content.width),
    y: Math.round(anchor.y - content.height),
    width: Math.max(1, Math.round(content.width)),
    height: Math.max(1, Math.round(content.height)),
  };
}
