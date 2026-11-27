import { appThemeColors, XopcThemeColors } from '../common/themePalette';

const AUDIO_CARD_WIDTH: number = 232;
const AUDIO_CARD_HEIGHT: number = 52;
const AUDIO_CARD_INSET: number = 8;

@ObservedV2
export class XopcFloatingAudioPosition {
  @Trace x?: number;
  @Trace y?: number;
}

@ComponentV2
export struct XopcFloatingAudioCard {
  @BuilderParam content: () => void;
  @Param cardId: string = '';
  @Param viewportWidth: number = 0;
  @Param viewportHeight: number = 0;
  @Param topClearance: number = 0;
  @Param bottomClearance: number = 0;
  @Param dockAtBottom: boolean = false;
  @Param dragPosition: XopcFloatingAudioPosition = new XopcFloatingAudioPosition();
  @Local colors: XopcThemeColors = appThemeColors;
  private dragStartX: number = 0;
  private dragStartY: number = 0;

  @Computed get cardWidth(): number {
    return Math.min(AUDIO_CARD_WIDTH, Math.max(0, this.viewportWidth - 2 * AUDIO_CARD_INSET));
  }

  private clampX(x: number): number {
    return Math.max(AUDIO_CARD_INSET, Math.min(x, this.viewportWidth - this.cardWidth - AUDIO_CARD_INSET));
  }

  private maxY(): number {
    return Math.max(AUDIO_CARD_INSET, this.viewportHeight - this.bottomClearance - AUDIO_CARD_HEIGHT - AUDIO_CARD_INSET);
  }

  private clampY(y: number): number {
    const maxY = this.maxY();
    const minY = Math.min(maxY, this.topClearance + AUDIO_CARD_INSET);
    return Math.min(maxY, Math.max(minY, y));
  }

  @Computed get cardX(): number {
    return this.clampX(this.dragPosition.x ?? (this.viewportWidth - this.cardWidth) / 2);
  }

  @Computed get cardY(): number {
    return this.clampY(this.dragPosition.y ?? (this.dockAtBottom ? this.maxY() : this.topClearance + AUDIO_CARD_INSET));
  }

  build() {
    if (this.viewportWidth > 2 * AUDIO_CARD_INSET && this.viewportHeight > AUDIO_CARD_HEIGHT) {
      Row({ space: 4 }) { this.content() }
        .id(this.cardId).width(this.cardWidth).height(AUDIO_CARD_HEIGHT).padding({ left: 4, right: 4 })
        .backgroundColor(this.colors.panel).borderRadius(26)
        .position({ x: this.cardX, y: this.cardY })
        .priorityGesture(PanGesture({ fingers: 1, direction: PanDirection.All, distance: 6 })
          .onActionStart((): void => {
            this.dragStartX = this.cardX;
            this.dragStartY = this.cardY;
          })
          .onActionUpdate((event: GestureEvent): void => {
            this.dragPosition.x = this.clampX(this.dragStartX + event.offsetX);
            this.dragPosition.y = this.clampY(this.dragStartY + event.offsetY);
          }))
    }
  }
}
