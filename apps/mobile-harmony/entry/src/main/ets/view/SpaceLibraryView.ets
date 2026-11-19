import { common } from '@kit.AbilityKit';
import { util } from '@kit.ArkTS';
import { fileIo as fs, picker } from '@kit.CoreFileKit';
import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { chatMediaSource } from '../common/chatMediaSource';
import { MAX_ATTACHMENT_BYTES } from '../common/attachments';
import { XopcChatAttachment, XopcHistoryMedia } from '../model/chat';
import { XopcMusicTrack } from '../model/musicPlayback';
import { XopcMusicPreviewContent, XopcPreviewHeader } from './MusicPlaybackView';
import { createManagedShare, shareChatLink, shareReachabilityText } from '../service/chatMediaShare';
import { copyChatMessage } from '../service/chatMessageActions';
import { appSettings } from '../service/settings';
import { layoutState, XopcLayoutState } from '../service/layoutState';
import { readChatMedia } from '../service/chatMedia';
import { downloadGatewayMediaFile, removeGeneratedMediaFile } from '../service/generatedMediaFile';
import { gatewaySession } from '../service/gatewaySession';
import { activeListScope, XopcListSnapshots } from '../service/listSnapshots';
import { XopcChatMediaView } from './ChatMediaView';
import { XopcListSkeleton, XopcPageHeader, XopcPaginationFooter } from './MobileComponents';
import { SEGMENTED_PAGE_TAP_SLOP_VP } from './SegmentedTabs';

interface XopcLibraryVersion {
  id: string;
  ordinal: number;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: number;
  indexStatus: string;
  music?: XopcLibraryMusic;
}

interface XopcLibraryMusic {
  id: string;
  conversationId: string;
  lyrics?: string;
  durationMs?: number;
}

export interface XopcLibraryOrigin {
  kind: string;
  versionId?: string;
  conversationId: string;
  projectId?: string;
  taskId?: string;
  automationRunId?: string;
  label?: string;
  available: boolean;
}

interface XopcLibraryHit { text: string; }

interface XopcLibraryItem {
  id: string;
  title: string;
  kind: string;
  favorite: boolean;
  trashedAt?: number;
  updatedAt: number;
  revision: number;
  currentVersion: XopcLibraryVersion;
  origin?: XopcLibraryOrigin;
  hit?: XopcLibraryHit;
  versions?: XopcLibraryVersion[];
  origins?: XopcLibraryOrigin[];
}

interface XopcLibraryPage { items: XopcLibraryItem[]; nextCursor?: string; }
interface XopcLibraryMutation { revision: number; title?: string; favorite?: boolean; }
interface XopcLibraryUndo { id: string; revision: number; }

const ITEM_PATH: string = '/api/spaces/items';
const LIBRARY_SCOPES: string[] = ['all', 'favorites', 'trash'];
const LIBRARY_KINDS: string[] = ['', 'document', 'spreadsheet', 'presentation', 'image', 'audio', 'video', 'archive', 'file'];
const snapshots = new XopcListSnapshots<XopcLibraryPage>();

@ObservedV2
class XopcLibraryScopeState {
  readonly scope: string;
  @Trace items: XopcLibraryItem[] = [];
  @Trace cursor: string = '';
  @Trace loading: boolean = true;
  @Trace listFailed: boolean = false;
  @Trace moreFailed: boolean = false;

  constructor(scope: string) { this.scope = scope; }
}

@ComponentV2
export struct XopcSpaceLibraryView {
  @Param initialId: string = '';
  @Event onExit: () => void = (): void => {};
  @Event onBackHandler: (handler?: () => boolean) => void = (_handler?: () => boolean): void => {};
  @Event onOpenSource: (source: XopcLibraryOrigin) => void = (_source: XopcLibraryOrigin): void => {};
  @Event onUseInChat: (file: XopcChatAttachment, source?: XopcLibraryOrigin) => Promise<void> =
    (_file: XopcChatAttachment, _source?: XopcLibraryOrigin): Promise<void> => Promise.resolve();
  @Local colors: XopcThemeColors = appThemeColors;
  @Local layout: XopcLayoutState = layoutState;
  @Local scope: string = 'all';
  @Local query: string = '';
  @Local kind: string = '';
  @Local selected?: XopcLibraryItem;
  @Local detailOpen: boolean = false;
  @Local detailLoaded: boolean = false;
  @Local searchHit: string = '';
  @Local versionId: string = '';
  @Local busy: boolean = false;
  @Local error: string = '';
  @Local editing: boolean = false;
  @Local titleDraft: string = '';
  @Local undo?: XopcLibraryUndo;
  private listRequest: number = 0;
  private detailRequest: number = 0;
  private leavingForSource: boolean = false;
  private searchTimer: number = -1;
  private pager: SwiperController = new SwiperController();
  private pages: XopcLibraryScopeState[] = LIBRARY_SCOPES.map((scope: string): XopcLibraryScopeState => new XopcLibraryScopeState(scope));

  @Computed get scopeIndex(): number { return Math.max(0, LIBRARY_SCOPES.indexOf(this.scope)); }

  aboutToAppear(): void {
    this.scope = appSettings.pageSelection('library-scope', LIBRARY_SCOPES, 'all');
    this.kind = appSettings.pageSelection('library-kind', LIBRARY_KINDS, '');
    this.onBackHandler((): boolean => {
      if (this.busy) return true;
      if (!this.detailOpen) return false;
      this.back();
      return true;
    });
    void this.load();
    if (this.initialId) void this.open(this.initialId);
  }

  aboutToDisappear(): void {
    this.onBackHandler();
    ++this.listRequest;
    ++this.detailRequest;
    clearTimeout(this.searchTimer);
  }

  private t(zh: string, en: string): string { return appSettings.effectiveLanguage().startsWith('zh') ? zh : en; }

  private get version(): XopcLibraryVersion | undefined {
    return this.selected?.versions?.find((entry: XopcLibraryVersion): boolean => entry.id === this.versionId)
      ?? this.selected?.currentVersion;
  }

  private get source(): XopcLibraryOrigin | undefined {
    const id = this.version?.id;
    const item = this.selected;
    return item?.origins?.find((source: XopcLibraryOrigin): boolean => source.available && source.versionId === id)
      ?? item?.origins?.find((source: XopcLibraryOrigin): boolean => source.available && !source.versionId)
      ?? (item?.origin?.available && (!item.origin.versionId || item.origin.versionId === id) ? item.origin : undefined);
  }

  private media(item: XopcLibraryItem, version: XopcLibraryVersion): XopcHistoryMedia {
    return { id: version.id, name: version.fileName, mimeType: version.mimeType, size: version.sizeBytes,
      type: item.kind, uri: 'xopc-space:' + item.id + '/' + version.id };
  }

  private async load(after: string = '', cached: boolean = true): Promise<void> {
    const state = this.pages[Math.max(0, LIBRARY_SCOPES.indexOf(this.scope))];
    if (after && (state.loading || state.cursor !== after || this.selected)) return;
    const seq = ++this.listRequest;
    const endpoint = ITEM_PATH + '?view=' + this.scope + '&q=' + encodeURIComponent(this.query.trim())
      + (this.kind ? '&kind=' + this.kind : '');
    const owner = activeListScope();
    const snapshot = !after && cached ? snapshots.read(owner, endpoint) : undefined;
    if (snapshot) { state.items = snapshot.items; state.cursor = snapshot.nextCursor ?? ''; }
    state.loading = true;
    state.listFailed = false;
    state.moreFailed = false;
    try {
      const page = JSON.parse(await gatewaySession.request(endpoint +
        (after ? '&cursor=' + encodeURIComponent(after) : ''))) as XopcLibraryPage;
      if (seq !== this.listRequest) return;
      if (!after) {
        state.items = page.items;
        snapshots.write(owner, endpoint, page, Date.now());
      } else {
        const known = new Set<string>(state.items.map((item: XopcLibraryItem): string => item.id));
        state.items = state.items.concat(page.items.filter((item: XopcLibraryItem): boolean => !known.has(item.id)));
      }
      state.cursor = page.nextCursor !== after ? page.nextCursor ?? '' : '';
    } catch (_) {
      if (seq === this.listRequest) {
        state.listFailed = !after;
        state.moreFailed = !!after;
      }
    }
    finally { if (seq === this.listRequest) state.loading = false; }
  }

  private setFilters(reset: boolean = true): void {
    clearTimeout(this.searchTimer);
    ++this.listRequest;
    const state = this.pages[Math.max(0, LIBRARY_SCOPES.indexOf(this.scope))];
    if (reset) { state.items = []; state.cursor = ''; }
    state.loading = true;
    state.listFailed = false;
    state.moreFailed = false;
    this.searchTimer = setTimeout((): void => { void this.load(); }, this.query ? 240 : 0);
  }

  private selectScope(scope: string): void {
    const index = LIBRARY_SCOPES.indexOf(scope);
    const current = LIBRARY_SCOPES.indexOf(this.scope);
    if (index < 0 || index === current || this.busy || this.detailOpen) return;
    this.pager.changeIndex(index, !this.layout.reduceMotion && Math.abs(index - current) === 1);
  }

  private commitScope(index: number): void {
    const scope = LIBRARY_SCOPES[index];
    if (!scope || scope === this.scope) return;
    this.getUIContext().getFocusController().clearFocus();
    this.scope = scope;
    appSettings.rememberPageSelection('library-scope', scope);
    this.query = ''; this.undo = undefined; this.error = ''; this.setFilters();
  }

  private async open(id: string, preview?: XopcLibraryItem): Promise<void> {
    const seq = ++this.detailRequest;
    this.selected = preview;
    this.detailLoaded = false;
    this.detailOpen = true;
    this.leavingForSource = false;
    this.searchHit = preview?.hit?.text ?? '';
    this.versionId = '';
    this.editing = false;
    this.error = '';
    try {
      const detail = JSON.parse(await gatewaySession.request(ITEM_PATH + '/' + encodeURIComponent(id))) as XopcLibraryItem;
      if (seq === this.detailRequest) this.selected = detail;
    } catch (_) { if (seq === this.detailRequest) this.error = this.t('资料暂不可用', 'Result unavailable'); }
    finally { if (seq === this.detailRequest) this.detailLoaded = true; }
  }

  private back(): void {
    if (this.busy) return;
    if (!this.detailOpen) { this.onExit(); return; }
    this.detailOpen = false;
  }

  private finishPreview(): void {
    ++this.detailRequest;
    this.selected = undefined;
    this.error = '';
    if (this.initialId && !this.leavingForSource) this.onExit();
  }

  private originLabel(source?: XopcLibraryOrigin): string {
    if (!source) return '';
    return source.label || (source.kind === 'task' ? this.t('任务', 'Task') :
      source.kind === 'automation' ? this.t('定时任务', 'Automation') : this.t('对话', 'Chat'));
  }

  private sourceActionLabel(): string {
    const source = this.source;
    if (source?.kind === 'task' && source.taskId) return this.t('查看来源任务', 'View source task');
    if (source?.kind === 'automation' && source.automationRunId) return this.t('查看执行记录', 'View run details');
    return this.t('查看来源对话', 'View source chat');
  }

  private date(time: number): string {
    return new Date(time).toLocaleDateString(appSettings.effectiveLanguage(), { month: 'short', day: 'numeric' });
  }

  private metadata(item: XopcLibraryItem): string {
    const extension = /\.([a-z\d]{1,12})$/i.exec(item.currentVersion.fileName)?.[1]?.toUpperCase() ?? '';
    return [extension, this.originLabel(item.origin)].filter((part: string): boolean => !!part).join(' · ');
  }

  private typeOptions(): SelectOption[] {
    return [
      { value: this.t('全部类型', 'All types') }, { value: this.t('文档', 'Documents') },
      { value: this.t('表格', 'Spreadsheets') }, { value: this.t('演示', 'Slides') },
      { value: this.t('图片', 'Images') }, { value: this.t('音频', 'Audio') }, { value: this.t('视频', 'Video') },
      { value: this.t('压缩包', 'Archives') }, { value: this.t('文件', 'Files') }
    ];
  }

  private typeIndex(): number {
    return Math.max(0, ['', 'document', 'spreadsheet', 'presentation', 'image', 'audio', 'video', 'archive', 'file'].indexOf(this.kind));
  }

  private versionLabel(item: XopcLibraryItem, version: XopcLibraryVersion): string {
    return (version.id === item.currentVersion.id ? this.t('最新版', 'Latest') : this.date(version.createdAt)) + ' · v' + version.ordinal;
  }

  private async change(action: string, id: string, body: XopcLibraryMutation): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.error = '';
    const path = ITEM_PATH + '/' + encodeURIComponent(id);
    try {
      if (action === 'patch') {
        this.selected = JSON.parse(await gatewaySession.request(path, 'PATCH', JSON.stringify(body))) as XopcLibraryItem;
        this.editing = false;
      } else {
        await gatewaySession.request(action === 'trash' ? path : path + '/' + action,
          action === 'trash' ? 'DELETE' : 'POST', JSON.stringify(body));
        this.undo = action === 'trash' ? { id, revision: body.revision + 1 } : undefined;
        if (this.selected?.id === id) this.detailOpen = false;
      }
      void this.load('', false);
    } catch (_) {
      this.error = this.t('操作未完成，请重试', 'Could not complete the action. Try again.');
      if (this.selected?.id === id) {
        try { this.selected = JSON.parse(await gatewaySession.request(path)) as XopcLibraryItem; } catch (_) {}
      }
    } finally { this.busy = false; }
  }

  private async confirmPurge(item: XopcLibraryItem): Promise<void> {
    try {
      const confirmation = await this.getUIContext().getPromptAction().showDialog({
        message: this.t('永久删除「' + item.title + '」？', 'Delete “' + item.title + '” permanently?'),
        buttons: [{ text: this.t('取消', 'Cancel'), color: this.colors.secondary },
          { text: this.t('删除', 'Delete'), color: this.colors.danger }]
      });
      if (confirmation.index === 1 && this.selected?.id === item.id) await this.change('purge', item.id, { revision: item.revision });
    } catch (_) {}
  }

  private async transfer(item: XopcLibraryItem, version: XopcLibraryVersion, reuse: boolean): Promise<void> {
    const context = this.getUIContext().getHostContext();
    if (this.busy || !context) return;
    this.getUIContext().getFocusController().clearFocus();
    this.busy = true;
    this.error = '';
    const file = this.media(item, version);
    const name = file.name.replace(/[\\/:*?"<>|]/g, '_') || 'attachment';
    const seq = this.detailRequest;
    const temp = context.cacheDir + '/xopc-library-' + util.generateRandomUUID();
    try {
      if (reuse) {
        if (version.sizeBytes > MAX_ATTACHMENT_BYTES || version.sizeBytes === 0) throw new Error('ATTACHMENT_LIMIT');
        const bytes = await readChatMedia(file, '', context);
        if (bytes.byteLength > MAX_ATTACHMENT_BYTES || bytes.byteLength === 0 || seq !== this.detailRequest) return;
        const attachment: XopcChatAttachment = { type: version.mimeType.startsWith('image/') ? 'image' : 'document',
          name, mimeType: version.mimeType, size: bytes.byteLength, data: new util.Base64Helper().encodeToStringSync(new Uint8Array(bytes)) };
        this.leavingForSource = true;
        await this.onUseInChat(attachment, this.source);
        this.detailOpen = false;
      } else {
        await downloadGatewayMediaFile(chatMediaSource(file.uri, '').path, temp, (): boolean => seq === this.detailRequest);
        const target = await new picker.DocumentViewPicker(context).save({ newFileNames: [name] });
        if (target.length && seq === this.detailRequest) {
          const output = await fs.open(target[0], fs.OpenMode.WRITE_ONLY | fs.OpenMode.TRUNC);
          try { await fs.copyFile(temp, output.fd); } finally { await fs.close(output); }
        }
      }
    } catch (_) {
      if (seq === this.detailRequest) {
        this.leavingForSource = false;
        this.error = this.t('操作未完成，请重试', 'Could not complete the action. Try again.');
      }
    }
    finally { await removeGeneratedMediaFile(temp); this.busy = false; }
  }

  @Builder
  listHeader() {
    XopcPageHeader({ heading: this.scope === 'favorites' ? this.t('收藏', 'Favorites')
      : this.scope === 'trash' ? this.t('回收站', 'Trash') : this.t('全部资料', 'All files'),
      backVisible: true, onBack: (): void => { this.back(); }, selectedTitle: this.scope, titleMenuId: 'space-scope-menu',
      titleOptions: [{ key: 'all', label: this.t('全部资料', 'All files'), id: 'space-tab-all' },
        { key: 'favorites', label: this.t('收藏', 'Favorites'), id: 'space-tab-favorites' },
        { key: 'trash', label: this.t('回收站', 'Trash'), id: 'space-tab-trash' }],
      onSelectTitle: (scope: string): void => {
        this.selectScope(scope);
      } }).id('space-library-header')
    Row({ space: 8 }) {
      TextInput({ text: this.query, placeholder: this.t('搜索资料', 'Search files') }).id('space-search')
        .layoutWeight(1).height(42).maxLength(160).backgroundColor(this.colors.input).fontColor(this.colors.foreground)
        .borderRadius(this.colors.corner(14)).onChange((value: string): void => { this.query = value; this.setFilters(); })
      Select(this.typeOptions()).id('space-file-type').selected(this.typeIndex()).value(this.typeOptions()[this.typeIndex()].value)
        .fontColor(this.colors.foreground).backgroundColor(this.colors.input)
        .optionFontColor(this.colors.foreground).optionBgColor(this.colors.panel)
        .selectedOptionFontColor(this.colors.accent).selectedOptionBgColor(this.colors.accentSoft)
        .onSelect((index: number): void => {
          this.kind = LIBRARY_KINDS[index] ?? '';
          appSettings.rememberPageSelection('library-kind', this.kind);
          this.setFilters();
        })
    }.width('100%').padding({ left: 20, right: 20, top: 8, bottom: 8 })
  }

  @Builder
  fileRow(item: XopcLibraryItem, scope: string) {
    Row({ space: 10 }) {
      Column() {
        SymbolGlyph(item.kind === 'audio' ? $r('sys.symbol.mic')
          : item.kind === 'image' ? $r('sys.symbol.picture')
          : item.kind === 'video' ? $r('sys.symbol.play_fill') : $r('sys.symbol.doc'))
          .fontSize(21).fontColor([this.colors.accent])
      }.width(40).height(40).justifyContent(FlexAlign.Center)
        .backgroundColor(this.colors.input).borderRadius(this.colors.corner(12))
      Column({ space: 3 }) {
        Text(item.title).fontSize(15).fontColor(this.colors.foreground).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
        Text([this.metadata(item), this.date(item.updatedAt)].filter((part: string): boolean => !!part).join(' · '))
          .fontSize(12).fontColor(this.colors.secondary).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
        if (item.hit?.text) {
          Text(item.hit.text).fontSize(12).fontColor(this.colors.secondary).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
        }
      }.layoutWeight(1).alignItems(HorizontalAlign.Start)
      SymbolGlyph($r('sys.symbol.chevron_right')).fontSize(13).fontColor([this.colors.tertiary])
    }.id('space-item-' + scope + '-' + item.id).width('100%').constraintSize({ minHeight: 56 }).padding(12)
      .borderRadius(this.colors.corner(12)).clipShape(this.colors.cornerClip(12)).backgroundColor(this.colors.panel)
      .onClick((): void => { void this.open(item.id, item); }, SEGMENTED_PAGE_TAP_SLOP_VP)
  }

  private track(item: XopcLibraryItem, version: XopcLibraryVersion): XopcMusicTrack {
    return { id: version.music?.id ?? version.id, conversationId: version.music?.conversationId ?? item.origin?.conversationId ?? '',
      title: item.title, sourceTitle: this.originLabel(this.source), lyrics: version.music?.lyrics,
      durationMs: version.music?.durationMs, versionNumber: version.ordinal, fileName: version.fileName,
      libraryItemId: item.id, libraryVersionId: version.id };
  }

  private async shareMedia(item: XopcLibraryItem, version: XopcLibraryVersion): Promise<void> {
    const ui = this.getUIContext();
    const context = ui.getHostContext() as common.UIAbilityContext | undefined;
    if (this.busy || !context) return;
    this.busy = true;
    this.error = '';
    const revision = gatewaySession.connectionRevision();
    try {
      const payload = await createManagedShare({ spaceVersion: { itemId: item.id, versionId: version.id },
        audience: 'friend', thumbnail: false });
      gatewaySession.assertConnection(revision);
      if (!this.detailOpen || this.selected?.id !== item.id) return;
      const result = await ui.getPromptAction().showDialog({ title: payload.share.title,
        message: payload.share.shareUrl + '\n\n' + shareReachabilityText(payload.share, appSettings.effectiveLanguage().startsWith('zh')),
        buttons: [{ text: $r('app.string.cancel'), color: this.colors.secondary },
          { text: $r('app.string.chat_copy_link'), color: this.colors.secondary },
          { text: $r('app.string.chat_system_share'), color: this.colors.accent }] });
      gatewaySession.assertConnection(revision);
      if (result.index === 1) {
        await copyChatMessage(payload.share.shareUrl);
        ui.getPromptAction().showToast({ message: $r('app.string.chat_link_copied') });
      } else if (result.index === 2) await shareChatLink(context, payload.share);
    } catch (_) {
      this.error = this.t('无法创建分享链接，请重试', 'Could not share. Try again.');
    } finally { this.busy = false; }
  }

  private actions(item: XopcLibraryItem, version: XopcLibraryVersion): MenuElement[] {
    const actions: MenuElement[] = [];
    if (!item.trashedAt) {
      if (version.mimeType.startsWith('audio/') || version.mimeType.startsWith('video/')) {
        actions.push({ value: this.t('分享链接', 'Share link'), enabled: !this.busy,
          action: (): void => { void this.shareMedia(item, version); } });
      }
      actions.push({ value: this.t('用此文件提问', 'Ask about this file'),
        enabled: !this.busy && version.sizeBytes > 0 && version.sizeBytes <= MAX_ATTACHMENT_BYTES,
        action: (): void => { void this.transfer(item, version, true); } });
      const source = this.source;
      if (source) {
        actions.push({ value: this.sourceActionLabel(), enabled: !this.busy,
          action: (): void => {
            this.leavingForSource = true;
            this.detailOpen = false;
            this.onOpenSource(source);
          } });
      }
      actions.push({ value: this.t('下载', 'Download'), enabled: !this.busy,
        action: (): void => { void this.transfer(item, version, false); } });
      actions.push({ value: item.favorite ? this.t('取消收藏', 'Remove favorite') : this.t('收藏', 'Favorite'), enabled: !this.busy,
        action: (): void => { void this.change('patch', item.id, { revision: item.revision, favorite: !item.favorite }); } });
      actions.push({ value: this.t('重命名', 'Rename'), enabled: !this.busy,
        action: (): void => { this.titleDraft = item.title; this.editing = true; } });
      actions.push({ value: this.t('移到回收站', 'Move to Trash'), enabled: !this.busy,
        action: (): void => { void this.change('trash', item.id, { revision: item.revision }); } });
    } else {
      actions.push({ value: this.t('恢复', 'Restore'), enabled: !this.busy,
        action: (): void => { void this.change('restore', item.id, { revision: item.revision }); } });
      actions.push({ value: this.t('永久删除', 'Delete permanently'), enabled: !this.busy,
        action: (): void => { void this.confirmPurge(item); } });
    }
    if ((item.versions?.length ?? 0) > 1) {
      item.versions?.forEach((entry: XopcLibraryVersion): void => {
        actions.push({ value: this.versionLabel(item, entry), enabled: !this.busy && entry.id !== version.id,
          action: (): void => { this.versionId = entry.id; } });
      });
    }
    return actions;
  }

  @Builder
  preview(item: XopcLibraryItem, version: XopcLibraryVersion) {
    XopcPreviewHeader({ title: item.title, actions: this.actions(item, version), onClose: (): void => { this.back(); } })
    if (this.editing) {
      Row() {
        TextInput({ text: this.titleDraft, placeholder: this.t('资料名称', 'Result name') })
          .layoutWeight(1).maxLength(240).onChange((title: string): void => { this.titleDraft = title; })
        Button(this.t('保存', 'Save')).enabled(!!this.titleDraft.trim() && !this.busy)
          .onClick((): void => { void this.change('patch', item.id, { revision: item.revision, title: this.titleDraft.trim() }); })
        Button(this.t('取消', 'Cancel')).onClick((): void => { this.editing = false; })
      }.padding({ left: 20, right: 20 })
    }
    Column() {
      if (version.mimeType.startsWith('audio/') && !this.detailLoaded) {
        XopcListSkeleton()
      } else if (version.mimeType.startsWith('audio/')) {
        XopcMusicPreviewContent({ track: this.track(item, version) })
      } else {
        XopcChatMediaView({ file: this.media(item, version), showLibraryActions: false, inlinePreview: true })
      }
    }.width('100%').layoutWeight(1).padding({ left: 8, right: 8 })
    if (version.id === item.currentVersion.id && this.searchHit) {
      Text(this.searchHit).fontSize(13).fontColor(this.colors.secondary).maxLines(2)
        .width('100%').padding({ left: 20, right: 20 })
    }

  }

  @Builder
  previewSheet() {
    Column() {
      if (this.selected && this.version) {
        this.preview(this.selected, this.version)
      } else {
        XopcPreviewHeader({ title: this.t('预览', 'Preview'), onClose: (): void => { this.back(); } })
        if (!this.error) {
          Column() { XopcListSkeleton() }.width('100%').layoutWeight(1).padding(20)
        }
      }
      if (this.error) {
        Text(this.error).fontSize(13).fontColor(this.colors.secondary).padding(16)
      }
    }.width('100%').height('100%')
  }

  @Builder
  fileList(page: XopcLibraryScopeState) {
    List({ space: 8 }) {
      if (page.loading && !page.items.length) {
        ListItem() { XopcListSkeleton() }
      } else if (page.listFailed) {
        ListItem() { Button(this.t('加载失败，重试', 'Could not load. Retry')).onClick((): void => { void this.load(); }) }
      } else if (!page.items.length) {
        ListItem() {
          Text(this.query ? this.t('没有匹配的资料', 'No matching results')
            : page.scope === 'favorites' ? this.t('暂无收藏', 'No favorites')
              : page.scope === 'trash' ? this.t('回收站为空', 'Trash is empty') : this.t('暂无资料', 'No results yet'))
            .width('100%').textAlign(TextAlign.Center).padding(24).fontColor(this.colors.secondary)
        }
      }
      Repeat<XopcLibraryItem>(page.items).each((entry: RepeatItem<XopcLibraryItem>) => {
        ListItem() { this.fileRow(entry.item, page.scope) }
      }).key((entry: XopcLibraryItem): string => entry.id).virtualScroll({ totalCount: page.items.length })
      if (page.cursor && !page.listFailed) {
        ListItem() {
          XopcPaginationFooter({ loadingPage: page.loading, failedPage: page.moreFailed,
            onLoad: (): void => { if (page.scope === this.scope) void this.load(page.cursor); } })
        }
      }
    }.id('space-list-' + page.scope).layoutWeight(1).width('100%').padding({ left: 20, right: 20 }).cachedCount(5)
  }

  build() {
    Column() {
      this.listHeader()
      Swiper(this.pager) {
        ForEach(this.pages, (page: XopcLibraryScopeState) => {
          Column() {
            this.fileList(page)
          }.width('100%').height('100%').accessibilityLevel(page.scope === this.scope ? 'auto' : 'no-hide-descendants')
        }, (page: XopcLibraryScopeState): string => page.scope)
      }.id('space-library-pager').index(this.scopeIndex).loop(false).indicator(false).cachedCount(2)
        .duration(this.layout.reduceMotion ? 0 : 230).disableSwipe(this.detailOpen || this.busy)
        .onChange((index: number): void => { this.commitScope(index); })
        .width('100%').layoutWeight(1).clip(true)
      if ((!this.detailOpen && this.error) || this.undo) {
        Row({ space: 8 }) {
          Text(this.error || this.t('已移到回收站', 'Moved to Trash')).fontSize(13).fontColor(this.colors.secondary).layoutWeight(1)
          if (this.undo) {
            Button(this.t('撤销', 'Undo')).enabled(!this.busy).onClick((): void => {
              if (this.undo) void this.change('restore', this.undo.id, { revision: this.undo.revision });
            })
          }
        }.width('100%').padding(12)
      }
    }.id('space-library').width('100%').height('100%').backgroundColor(this.colors.surface)
      .bindSheet($$this.detailOpen, this.previewSheet, { height: '95%', dragBar: true, showClose: false,
        backgroundColor: this.colors.chat.canvas,
        onWillDismiss: (action: DismissSheetAction): void => { if (!this.busy) action.dismiss(); },
        onDisappear: (): void => { this.finishPreview(); } })
  }
}
