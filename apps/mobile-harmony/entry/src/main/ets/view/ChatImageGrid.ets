import { chatImageGridColumns, chatImageGridHeight } from '../common/chatImageViewport';
import { XopcHistoryMedia } from '../model/chat';
import { XopcChatMediaView } from './ChatMediaView';

@ComponentV2
export struct XopcChatImageGrid {
  @Param files: XopcHistoryMedia[] = [];
  @Param gallery: XopcHistoryMedia[] = [];
  @Param conversationId: string = '';
  @Local gridWidth: number = 280;
  @Computed get columns(): number { return chatImageGridColumns(this.files.length); }
  @Computed get tileSize(): number { return Math.max(1, (this.gridWidth - (this.columns - 1) * 6) / this.columns); }
  build() {
    Grid() {
      ForEach(this.files, (file: XopcHistoryMedia) => {
        GridItem() {
          XopcChatMediaView({ file, conversationId: this.conversationId, compact: true, embedded: true,
            compactThumbnail: true, compactMetadata: false, compactDisclosure: false,
            compactThumbnailWidth: this.tileSize, compactThumbnailHeight: this.tileSize,
            imageGallery: this.gallery.length ? this.gallery : this.files })
        }.width('100%').aspectRatio(1).borderRadius(10).clip(true)
      }, (file: XopcHistoryMedia): string => file.id || file.uri)
    }.id('chat-image-grid').columnsTemplate(this.columns === 1 ? '1fr' : this.columns === 2 ? '1fr 1fr' : '1fr 1fr 1fr')
      .columnsGap(6).rowsGap(6).scrollBar(BarState.Off).enableScrollInteraction(false)
      .width('100%').height(chatImageGridHeight(this.files.length, this.gridWidth, 6))
      .onAreaChange((_old: Area, area: Area): void => { this.gridWidth = Number(area.width); })
  }
}
