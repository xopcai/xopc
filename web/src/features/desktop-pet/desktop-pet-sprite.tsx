import type { CSSProperties } from 'react';

import { cn } from '@/lib/cn';
import type { DesktopPetAction, DesktopPetDefinition } from '@/types/electron';

const FRAME_BLEED_PX = 8;

export function DesktopPetSprite({
  pet,
  action,
  size = 'normal',
  displayHeight: displayHeightOverride,
  className,
}: {
  pet: DesktopPetDefinition;
  action: DesktopPetAction;
  size?: 'tiny' | 'small' | 'normal';
  displayHeight?: number;
  className?: string;
}) {
  const animation = pet.animations[action];
  const defaultDisplayHeight = size === 'tiny' ? 40 : size === 'small' ? 54 : 112;
  const displayHeight = Math.max(1, Math.round(displayHeightOverride ?? defaultDisplayHeight));
  const scale = displayHeight / animation.frameHeight;
  const displayWidth = Math.round(animation.frameWidth * scale);
  const sheetHeight = Math.max(
    animation.sheetHeight ?? 0,
    animation.offsetY + animation.frameHeight,
    ...Object.values(pet.animations)
      .filter((item) => item.imageDataUrl === animation.imageDataUrl)
      .map((item) => item.offsetY + item.frameHeight),
  );
  const sheetWidth = Math.max(
    animation.sheetWidth ?? 0,
    animation.offsetX + animation.frameWidth * animation.frameCount,
    ...Object.values(pet.animations)
      .filter((item) => item.imageDataUrl === animation.imageDataUrl)
      .map((item) => item.offsetX + item.frameWidth * item.frameCount),
  );
  const visibleFrameHeight = Math.min(animation.frameHeight + FRAME_BLEED_PX, sheetHeight - animation.offsetY);
  const displayFrameHeight = Math.round(visibleFrameHeight * scale);
  const durationSeconds = Math.max(0.1, animation.frameCount / animation.fps);
  const style = {
    width: `${displayWidth}px`,
    height: `${displayFrameHeight}px`,
    backgroundSize: `${Math.round(sheetWidth * scale)}px ${Math.round(sheetHeight * scale)}px`,
    '--pet-frame-count': animation.frameCount,
    '--pet-frame-start-x': `${-animation.offsetX * scale}px`,
    '--pet-frame-start-y': `${-animation.offsetY * scale}px`,
    '--pet-frame-end-x': `${-(animation.offsetX + animation.frameWidth * animation.frameCount) * scale}px`,
    '--pet-animation-duration': `${durationSeconds}s`,
    backgroundImage: `url("${animation.imageDataUrl}")`,
  } as CSSProperties;

  return (
    <span
      className={cn(
        'desktop-pet-sprite',
        `desktop-pet-sprite--${action}`,
        animation.loop ? 'desktop-pet-sprite--loop' : 'desktop-pet-sprite--once',
        size === 'tiny' && 'desktop-pet-sprite--tiny',
        size === 'small' && 'desktop-pet-sprite--small',
        className,
      )}
      style={style}
      aria-hidden
    />
  );
}
