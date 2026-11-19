import { SEGMENTED_PAGE_TAP_SLOP_VP, XopcSegmentedTabs } from './SegmentedTabs';
import { artifactMedia, chatProductCapability } from '../common/chatRichContent';
import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { XopcHistoryMedia, XopcProductReference } from '../model/chat';
import { XopcMobileRoute } from '../model/home';
import { XopcPersonalAgentRecord } from '../model/personalAgent';
import { XopcPersonalDelivery, XopcPersonalWorkGroup, XopcPersonalWorkItem } from '../model/personalOverview';
import { XopcAutomation } from '../model/workspace';
import { appSettings } from '../service/settings';
import { generatedMusicPlayback } from '../service/generatedMusicPlayback';
import { XopcPersonalOverviewViewModel } from '../viewmodel/personalOverviewViewModel';
import { XopcChatMediaView } from './ChatMediaView';
import { XopcListSkeleton, XopcPaginationFooter } from './MobileComponents';
import { XopcPersonalAgentAvatar } from './PersonalAgentAvatar';
import { XopcPersonalLibraryThumbnail } from './PersonalLibraryThumbnail';
import { XopcAutomationIdeas } from './AutomationIdeas';

interface XopcOverviewRow {
  title: ResourceStr;
  subtitle: ResourceStr;
  stamp: string;
  symbol?: Resource;
  marker?: ResourceColor;
  attention?: boolean;
  delivery?: XopcPersonalDelivery;
  onOpen: () => void;
}

interface XopcPersonalDeliveryPreview {
  file: XopcHistoryMedia;
  conversationId: string;
}

interface XopcOverviewWorkSection {
  label: ResourceStr;
  items: XopcPersonalWorkItem[];
  attention?: boolean;
}

const PERSONAL_HEADER_TRAVEL: number = 60;
const PERSONAL_AVATAR_EXPANDED: number = 116;
const PERSONAL_AVATAR_COMPACT: number = 68;

@ComponentV2
export struct XopcPersonalAgentOverview {
  @Param record: XopcPersonalAgentRecord | null = null;
  @Param activePage: boolean = true;
  @Param canShareConversation: boolean = false;
  @Event onClose: () => void = (): void => {};
  @Event onNavigate: (route: XopcMobileRoute) => void = (_route: XopcMobileRoute): void => {};
  @Local colors: XopcThemeColors = appThemeColors;
  @Local model: XopcPersonalOverviewViewModel = new XopcPersonalOverviewViewModel();
  @Local librarySelected: boolean = false;
  @Local headerTravel: number = 0;
  @Local deliveryPreview?: XopcPersonalDeliveryPreview;
  @Computed get headerProgress(): number { return this.headerTravel / PERSONAL_HEADER_TRAVEL; }
  @Computed get avatarExtent(): number {
    return PERSONAL_AVATAR_EXPANDED - (PERSONAL_AVATAR_EXPANDED - PERSONAL_AVATAR_COMPACT) * this.headerProgress;
  }
  @Computed get avatarScale(): number { return this.avatarExtent / PERSONAL_AVATAR_EXPANDED; }

  aboutToAppear(): void { this.refresh(); }
  aboutToDisappear(): void { this.model.dispose(); }

  @Monitor('activePage')
  refresh(): void {
    if (!this.activePage || !this.record?.conversationId) return;
    void this.model.work();
    void this.model.loadPrompt(this.record.conversationId);
    void this.model.loadSchedules();
    if (this.librarySelected) void this.model.loadDeliveries();
  }

  private selectLibrary(selected: boolean): void {
    if (this.librarySelected === selected) return;
    this.librarySelected = selected;
    if (selected && !this.model.deliveryLoaded && !this.model.deliveryError) void this.model.loadDeliveries();
  }

  private scrollHeader(xOffset: number, yOffset: number, source: ScrollSource): OffsetResult {
    if (source !== ScrollSource.DRAG && source !== ScrollSource.FLING && source !== ScrollSource.OTHER_USER_INPUT) {
      return { xOffset, yOffset };
    }
    const next = Math.max(0, Math.min(PERSONAL_HEADER_TRAVEL, this.headerTravel + yOffset));
    const consumed = next - this.headerTravel;
    if (consumed !== 0) this.headerTravel = next;
    // Apply each part of the scroll to either the header or the content.
    return { xOffset, yOffset: yOffset - consumed };
  }

  private time(timestamp: number, withTime: boolean = false): string {
    if (!Number.isFinite(timestamp) || timestamp <= 0) return '';
    const locale = appSettings.effectiveLanguage().startsWith('zh') ? 'zh-CN' : 'en-US';
    const date = new Date(timestamp);
    return date.toLocaleDateString(locale, withTime
      ? { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }
      : { month: 'numeric', day: 'numeric' });
  }

  private status(item: XopcPersonalWorkItem): ResourceStr {
    switch (item.presentation?.status ?? item.operationalState ?? item.phase) {
      case 'needsUser': return $r('app.string.personal_overview_attention');
      case 'review': return $r('app.string.task_phase_review');
      case 'waiting': return $r('app.string.task_execution_waiting');
      case 'blocked': return $r('app.string.task_execution_blocked');
      case 'paused': return $r('app.string.paused');
      case 'running': return $r('app.string.status_running');
      case 'verifying': return $r('app.string.task_execution_verifying');
      case 'queued':
      case 'allocating': return $r('app.string.status_queued');
      case 'failed': return $r('app.string.status_failed');
      case 'cancelled': return $r('app.string.status_cancelled');
      case 'completed': return $r('app.string.status_succeeded');
      case 'closed':
      case 'ended': return $r('app.string.task_phase_closed');
      case 'backlog': return $r('app.string.task_phase_backlog');
      case 'active':
      case 'in_progress': return $r('app.string.task_phase_in_progress');
      default: return $r('app.string.task_phase_ready');
    }
  }

  private marker(item: XopcPersonalWorkItem): ResourceColor | undefined {
    const status = item.presentation?.status ?? item.operationalState ?? '';
    if (status === 'failed') return this.colors.danger;
    if (item.attention || ['needsUser', 'review', 'waiting', 'blocked'].includes(status)) {
      return this.colors.attentionForeground;
    }
    if (status === 'completed') return this.colors.success;
    if (['running', 'verifying'].includes(status)) return this.colors.accent;
    return undefined;
  }

  private taskSymbol(item: XopcPersonalWorkItem): Resource {
    const status = item.presentation?.status ?? item.operationalState ?? item.phase;
    if (['completed', 'closed', 'ended'].includes(status)) return $r('sys.symbol.checkmark_circle');
    if (['blocked', 'failed'].includes(status)) return $r('sys.symbol.exclamationmark_circle');
    if (['running', 'verifying', 'waiting', 'queued'].includes(status)) return $r('sys.symbol.clock');
    return $r('sys.symbol.circle');
  }

  private historyTitle(id: string): Resource {
    if (id === 'today') return $r('app.string.chat_today');
    if (id === 'week') return $r('app.string.chat_this_week');
    return $r('app.string.chat_earlier');
  }

  private referenceRoute(reference?: XopcProductReference): string {
    if (!chatProductCapability(reference, 'open')) return '';
    switch (reference?.kind) {
      case 'note': return 'notes';
      case 'file': return 'files';
      case 'task': return 'tasks';
      case 'project': return 'projects';
      case 'automation': return 'automations';
      case 'session': return 'chat';
      default: return '';
    }
  }

  private returnToDeliverySource(item: XopcPersonalDelivery): void {
    if (item.task?.id) this.onNavigate({ page: 'tasks', itemId: item.task.id });
    else this.onClose();
  }

  private deliveryScope(item: XopcPersonalDelivery): string {
    return item.task?.conversationId ?? this.record?.conversationId ?? '';
  }

  private deliveryFile(item: XopcPersonalDelivery): XopcHistoryMedia | undefined {
    const artifact = item.artifact;
    if (artifact?.availability !== 'available') return undefined;
    const uri = artifact.uri ?? '';
    if (uri ? /^(xopc-file:|xopc-file-version:|xopc-space:|xopc-attachment:\/\/notes\/|media:\/\/|data:)/.test(uri)
      : !!artifact.workspaceRelativePath) {
      return artifactMedia(artifact);
    }
    return undefined;
  }

  private deliveryThumbnailFile(item: XopcPersonalDelivery): XopcHistoryMedia | undefined {
    const file = this.deliveryFile(item);
    if (file) return file;
    const reference = item.reference;
    if (!item.artifact && reference?.id && this.referenceRoute(reference) === 'files') {
      return { id: reference.id, name: reference.title, type: 'file', mimeType: '', size: 0,
        uri: 'xopc-file:' + encodeURIComponent(reference.id) };
    }
    return undefined;
  }

  private openDelivery(item: XopcPersonalDelivery): void {
    const file = this.deliveryFile(item);
    const scope = this.deliveryScope(item);
    if (file) {
      this.deliveryPreview = { file, conversationId: scope };
      return;
    }
    const reference = item.reference;
    const page = this.referenceRoute(reference);
    if (page && reference?.id) {
      this.onNavigate({ page, itemId: reference.id });
      return;
    }
    const artifact = item.artifact;
    const expected = '/api/music-generation/sessions/' + encodeURIComponent(scope) + '/jobs/' +
      encodeURIComponent(artifact?.artifactId ?? '') + '/audio';
    const context = this.getUIContext().getHostContext();
    if (scope && context && artifact?.availability === 'available' && artifact.uri === expected) {
      if (!generatedMusicPlayback.matches(scope, artifact.artifactId)) {
        void generatedMusicPlayback.play({ id: artifact.artifactId, conversationId: scope,
          title: artifact.title, sourceTitle: item.task?.title ?? this.record?.displayName ?? '' });
      }
      generatedMusicPlayback.open();
      return;
    }
    this.returnToDeliverySource(item);
  }

  @Builder entry($$: XopcOverviewRow) {
    Button({ type: ButtonType.Normal }) {
      Row({ space: 14 }) {
        if ($$.delivery) {
          XopcPersonalLibraryThumbnail({ file: this.deliveryThumbnailFile($$.delivery),
            conversationId: this.deliveryScope($$.delivery),
            mediaKind: $$.delivery.artifact?.kind ?? $$.delivery.reference?.kind ?? '' })
        } else {
          Stack({ alignContent: Alignment.Center }) {
            SymbolGlyph($$.symbol ?? $r('sys.symbol.checkmark_circle')).fontSize(19)
              .fontColor([$$.attention ? this.colors.attentionForeground : this.colors.secondary])
          }.width(32).height(32).borderRadius(this.colors.corner(10))
            .backgroundColor($$.attention ? this.colors.attentionFill : this.colors.grouped)
            .accessibilityLevel('no')
        }
        Column({ space: 5 }) {
          Text($$.title).fontSize(16).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground)
            .lineHeight('22fp').width('100%').maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
          Row({ space: 6 }) {
            if ($$.marker !== undefined) { Blank().width(6).height(6).borderRadius(3).backgroundColor($$.marker) }
            Text($$.subtitle).fontSize(13)
              .fontColor($$.attention ? this.colors.attentionForeground : this.colors.secondary).maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis }).flexShrink(1)
            if ($$.stamp) {
              Text('·').fontSize(13).fontColor(this.colors.tertiary)
              Text($$.stamp).fontSize(13).fontColor(this.colors.secondary).maxLines(1).flexShrink(0)
            }
          }.width('100%').alignItems(VerticalAlign.Center)
        }.layoutWeight(1).alignItems(HorizontalAlign.Start)
        SymbolGlyph($r('sys.symbol.chevron_right')).fontSize(12).fontColor([this.colors.tertiary])
          .accessibilityLevel('no')
      }.width('100%').padding({ left: 16, right: 16, top: 14, bottom: 14 })
    }.width('100%').constraintSize({ minHeight: $$.delivery ? 88 : 70 }).padding(0)
      .backgroundColor(Color.Transparent)
      .onClick((): void => { $$.onOpen(); }, SEGMENTED_PAGE_TAP_SLOP_VP)
  }

  @Builder groupHeading(label: ResourceStr) {
    Text(label).fontSize(17).fontWeight(FontWeight.Bold).fontColor(this.colors.foreground)
      .width('100%').padding({ left: 4, right: 4 })
  }

  @Builder workRow(item: XopcPersonalWorkItem, attention: boolean = false) {
    Column() {
      this.entry({ title: item.title, subtitle: this.status(item), stamp: this.time(item.updatedAt),
        symbol: attention ? $r('sys.symbol.bell') : this.taskSymbol(item),
        marker: attention ? this.colors.attentionForeground : this.marker(item), attention,
        onOpen: (): void => { this.onNavigate({ page: 'tasks', itemId: item.id }); } })
    }.id('personal-overview-task-' + item.id).width('100%')
  }

  @Builder scheduleRow(item: XopcAutomation) {
    Column() {
      this.entry({ title: item.name, subtitle: !item.enabled ? $r('app.string.paused')
        : item.trigger.schedule?.kind === 'cron' ? $r('app.string.personal_overview_repeats') : $r('app.string.schedule'),
        stamp: item.enabled ? this.time(item.state?.nextRunAtMs ?? 0, true) : '',
        symbol: $r('sys.symbol.clock'), onOpen: (): void => { this.onNavigate({ page: 'automations', itemId: item.id }); } })
    }.id('personal-overview-schedule-' + item.id).width('100%')
  }

  @Builder workGroup($$: XopcOverviewWorkSection) {
    Column({ space: 10 }) {
      this.groupHeading($$.label)
      Column() {
        if ($$.attention && this.model.prompt) {
          this.entry({ title: this.model.prompt.question, subtitle: $r('app.string.personal_overview_attention'), stamp: '',
            symbol: $r('sys.symbol.bell'), marker: this.colors.attentionForeground, attention: true, onOpen: this.onClose })
        }
        ForEach($$.items, (item: XopcPersonalWorkItem) => {
          this.workRow(item, $$.attention ?? false)
        }, (item: XopcPersonalWorkItem): string => item.id)
      }.width('100%').backgroundColor(this.colors.panel).borderRadius(this.colors.corner(20)).clip(true)
    }.width('100%').alignItems(HorizontalAlign.Start)
  }

  @Builder tasks() {
    Column({ space: 24 }) {
      if (this.model.workLoading && !this.model.workLoaded) { XopcListSkeleton() }
      if (this.model.attentionCount > 0) {
        this.workGroup({ label: $r('app.string.personal_overview_attention'), items: this.model.attention, attention: true })
      }
      if (this.model.active.length) {
        this.workGroup({ label: $r('app.string.personal_overview_current'), items: this.model.active })
      }
      this.schedules()
      ForEach(this.model.groups, (group: XopcPersonalWorkGroup) => {
        this.workGroup({ label: this.historyTitle(group.id), items: group.items })
      }, (group: XopcPersonalWorkGroup): string => group.id)
      if (this.model.workError || this.model.moreWork) {
        XopcPaginationFooter({ loadingPage: this.model.workLoading, failedPage: !!this.model.workError,
          onLoad: (): void => { void this.model.work(this.model.moreWork); } })
      }
    }.id('personal-overview-task-list').width('100%').alignItems(HorizontalAlign.Start)
      .padding({ top: 4, bottom: 24 })
  }

  @Builder schedules() {
    Column({ space: 8 }) {
      Row() {
        Text($r('app.string.personal_overview_schedules')).fontSize(17).fontWeight(FontWeight.Bold)
          .fontColor(this.colors.foreground).layoutWeight(1)
        Button($r('app.string.personal_overview_new_schedule')).id('personal-overview-new-schedule')
          .height(44).padding({ left: 12, right: 4 }).fontSize(14).fontColor(this.colors.accent)
          .backgroundColor(Color.Transparent).enabled(!!this.record?.conversationId)
          .onClick((): void => { this.openScheduleSetup(); })
      }.width('100%').padding({ left: 4 })
      if (this.model.schedulesLoading && !this.model.schedules.length) { XopcListSkeleton() }
      if (this.model.scheduleError) {
        Button($r('app.string.retry')).height(44).backgroundColor(Color.Transparent).fontColor(this.colors.accent)
          .onClick((): void => { void this.model.loadSchedules(); })
      }
      if (this.model.schedules.length) {
        Column() {
          ForEach(this.model.schedules, (item: XopcAutomation) => {
            this.scheduleRow(item)
          }, (item: XopcAutomation): string => item.id)
        }.width('100%').backgroundColor(this.colors.panel).borderRadius(this.colors.corner(20)).clip(true)
      }
      if (this.model.schedulesLoaded && !this.model.schedulesLoading && !this.model.schedules.length && !this.model.scheduleError) {
        XopcAutomationIdeas({ onChoose: (prompt: string): void => { this.openScheduleSetup(prompt); } })
      }
    }.width('100%').alignItems(HorizontalAlign.Start)
  }

  private openScheduleSetup(prompt: string = ''): void {
    if (!this.record?.conversationId) return;
    this.onNavigate({ page: 'automation-setup', itemId: '', personalSchedule: true, prompt });
  }

  @Builder library() {
    Column({ space: 16 }) {
      if (!this.model.deliveryLoaded && !this.model.deliveryError) { XopcListSkeleton() }
      if (this.model.deliveries.length) {
        Column({ space: 10 }) {
          ForEach(this.model.deliveries, (item: XopcPersonalDelivery) => {
            Column() {
              this.entry({ title: item.artifact?.title ?? item.reference?.title ?? $r('app.string.untitled'),
                subtitle: item.task?.title ?? $r('app.string.personal_overview_source'), stamp: this.time(item.createdAt),
                delivery: item, onOpen: (): void => { this.openDelivery(item); } })
            }.id('personal-overview-delivery-' + item.id).width('100%')
              .backgroundColor(this.colors.panel).borderRadius(this.colors.corner(20)).clip(true)
          }, (item: XopcPersonalDelivery): string => item.id)
        }.width('100%')
      }
      if (this.model.deliveryLoaded && !this.model.deliveries.length && !this.model.deliveryError && !this.model.deliveryLoading) {
        Column({ space: 12 }) {
          SymbolGlyph($r('sys.symbol.doc_text')).fontSize(28).fontColor([this.colors.tertiary]).accessibilityLevel('no')
          Text($r('app.string.personal_overview_no_deliveries')).fontSize(15).fontColor(this.colors.secondary)
            .textAlign(TextAlign.Center)
        }.width('100%').padding(32).backgroundColor(this.colors.panel).borderRadius(this.colors.corner(20))
      }
      if (this.model.deliveryError || this.model.nextDeliveryOffset !== null) {
        XopcPaginationFooter({ loadingPage: this.model.deliveryLoading, failedPage: !!this.model.deliveryError,
          onLoad: (): void => {
            if (this.model.deliveryError) void this.model.retryDeliveries();
            else void this.model.loadDeliveries(true);
          } })
      }
    }.id('personal-overview-library-list').width('100%').alignItems(HorizontalAlign.Start)
      .padding({ top: 4, bottom: 24 })
  }

  build() {
    Column() {
      Row() {
        Button({ type: ButtonType.Circle }) {
          SymbolGlyph($r('sys.symbol.xmark')).fontSize(22).fontColor([this.colors.secondary])
        }.id('personal-overview-close').width(44).height(44).padding(0).backgroundColor(Color.Transparent)
          .accessibilityText($r('app.string.close')).onClick((): void => { this.onClose(); })
      }.width('100%').justifyContent(FlexAlign.End).padding({ left: 12, right: 12 })
      Stack({ alignContent: Alignment.BottomEnd }) {
        Stack({ alignContent: Alignment.Center }) {
          Stack() {
            XopcPersonalAgentAvatar({ agentId: this.record?.agentId ?? '', revision: this.record?.revision ?? 0,
              appearance: this.record?.appearance ?? 'loopi', extent: 110, activePage: this.activePage,
              moodOverride: this.model.attentionCount ? 'care' : this.model.runningCount ? 'work' : undefined })
          }.width(PERSONAL_AVATAR_EXPANDED).height(PERSONAL_AVATAR_EXPANDED).borderRadius(PERSONAL_AVATAR_EXPANDED / 2)
            .backgroundColor(this.colors.grouped).scale({ x: this.avatarScale, y: this.avatarScale })
        }.id('personal-overview-avatar').width(this.avatarExtent).height(this.avatarExtent)
        Button({ type: ButtonType.Circle }) {
          Stack() {
            SymbolGlyph($r('sys.symbol.pencil_line')).fontSize(18 - 3 * this.headerProgress).fontColor([this.colors.foreground])
          }.width(44 - 10 * this.headerProgress).height(44 - 10 * this.headerProgress)
            .borderRadius(this.colors.corner(22)).backgroundColor(this.colors.chat.card)
        }.id('personal-overview-edit').width(44).height(44).padding(0).backgroundColor(Color.Transparent)
          .translate({ x: 7 * this.headerProgress, y: 7 * this.headerProgress })
          .accessibilityText($r('app.string.personal_overview_edit'))
          .onClick((): void => {
            this.onNavigate({ page: 'personal-agent-profile', itemId: '', canShareConversation: this.canShareConversation });
          })
      }
      Text(this.record?.displayName ?? '').fontSize(24).fontWeight(FontWeight.Bold).fontColor(this.colors.foreground)
        .textAlign(TextAlign.Center).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
        .width('100%').padding({ left: 16, right: 16, top: 8 - 4 * this.headerProgress })
      if (this.model.attentionCount || this.model.runningCount) {
        Row({ space: 6 }) {
          if (this.model.attentionCount) {
            Blank().width(6).height(6).borderRadius(3).backgroundColor(this.colors.attentionForeground)
            Text($r('app.string.chat_attention_count', this.model.attentionCount)).fontSize(14)
              .fontColor(this.colors.attentionForeground)
          } else {
            Blank().width(6).height(6).borderRadius(3).backgroundColor(this.colors.accent)
            Text($r('app.string.personal_overview_running', this.model.runningCount)).fontSize(14).fontColor(this.colors.secondary)
          }
        }.constraintSize({ minHeight: 24 }).margin({ top: 4 - 2 * this.headerProgress })
      }
      Column() {
        XopcSegmentedTabs({ options: [
          { key: 'tasks', label: $r('app.string.tasks'), icon: $r('sys.symbol.checkmark_circle'), count: this.model.attentionCount || undefined, testId: 'personal-overview-tasks-tab' },
          { key: 'library', label: $r('app.string.personal_overview_library'), icon: $r('sys.symbol.doc_text'), testId: 'personal-overview-library-tab' }
        ], selectedKey: this.librarySelected ? 'library' : 'tasks',
          onSelect: (key: string): void => { this.selectLibrary(key === 'library'); } })
      }.width('100%').margin({ top: 12 - 4 * this.headerProgress, bottom: 16 })
      if (this.librarySelected) {
        Scroll() { this.library() }.width('100%').layoutWeight(1).scrollBar(BarState.Auto)
          .onWillScroll((x: number, y: number, _state: ScrollState, source: ScrollSource): OffsetResult =>
            this.scrollHeader(x, y, source))
      } else {
        Scroll() { this.tasks() }.width('100%').layoutWeight(1).scrollBar(BarState.Auto)
          .onWillScroll((x: number, y: number, _state: ScrollState, source: ScrollSource): OffsetResult =>
            this.scrollHeader(x, y, source))
      }
      if (this.deliveryPreview) {
        XopcChatMediaView({ file: this.deliveryPreview.file, conversationId: this.deliveryPreview.conversationId,
          previewOnly: true, onPreviewClosed: (): void => { this.deliveryPreview = undefined; } })
      }
    }.id('personal-overview').width('100%').height('100%').constraintSize({ maxWidth: 640 })
      .padding({ left: 20, right: 20 }).backgroundColor(this.colors.surface)
  }
}
