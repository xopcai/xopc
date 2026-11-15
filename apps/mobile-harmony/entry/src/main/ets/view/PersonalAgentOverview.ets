import { XopcSegmentedTabs } from './SegmentedTabs';
import { artifactMedia, chatProductCapability } from '../common/chatRichContent';
import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { XopcProductReference } from '../model/chat';
import { XopcMobileRoute } from '../model/home';
import { XopcPersonalAgentRecord } from '../model/personalAgent';
import { XopcPersonalDelivery, XopcPersonalWorkGroup, XopcPersonalWorkItem } from '../model/personalOverview';
import { XopcAutomation } from '../model/workspace';
import { appSettings } from '../service/settings';
import { generatedMusicPlayback } from '../service/generatedMusicPlayback';
import { XopcPersonalOverviewViewModel } from '../viewmodel/personalOverviewViewModel';
import { XopcChatMediaView } from './ChatMediaView';
import { XopcListSkeleton } from './MobileComponents';
import { XopcPersonalAgentAvatar } from './PersonalAgentAvatar';
import { XopcAutomationIdeas } from './AutomationIdeas';

interface XopcOverviewRow {
  title: ResourceStr;
  subtitle: ResourceStr;
  stamp: string;
  symbol: Resource;
  marker?: ResourceColor;
  attention?: boolean;
  onOpen: () => void;
}

const PERSONAL_HEADER_TRAVEL: number = 60;
const PERSONAL_AVATAR_EXPANDED: number = 116;
const PERSONAL_AVATAR_COMPACT: number = 68;

@ComponentV2
export struct XopcPersonalAgentOverview {
  @Param record: XopcPersonalAgentRecord | null = null;
  @Param activePage: boolean = true;
  @Event onClose: () => void = (): void => {};
  @Event onNavigate: (route: XopcMobileRoute) => void = (_route: XopcMobileRoute): void => {};
  @Local colors: XopcThemeColors = appThemeColors;
  @Local model: XopcPersonalOverviewViewModel = new XopcPersonalOverviewViewModel();
  @Local librarySelected: boolean = false;
  @Local headerTravel: number = 0;
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

  private openDelivery(item: XopcPersonalDelivery): void {
    const reference = item.reference;
    const page = this.referenceRoute(reference);
    if (page && reference?.id) {
      this.onNavigate({ page, itemId: reference.id });
      return;
    }
    const artifact = item.artifact;
    const scope = item.task?.conversationId ?? this.record?.conversationId ?? '';
    const expected = '/api/music-generation/sessions/' + encodeURIComponent(scope) + '/jobs/' +
      encodeURIComponent(artifact?.artifactId ?? '') + '/audio';
    const context = this.getUIContext().getHostContext();
    if (scope && context && artifact?.availability === 'available' && artifact.uri === expected) {
      if (!generatedMusicPlayback.matches(scope, artifact.artifactId)) {
        void generatedMusicPlayback.play(context.cacheDir, { id: artifact.artifactId, conversationId: scope,
          title: artifact.title, sourceTitle: item.task?.title ?? this.record?.displayName ?? '' });
      }
      generatedMusicPlayback.open();
      return;
    }
    this.returnToDeliverySource(item);
  }

  @Builder entry($$: XopcOverviewRow) {
    Button({ type: ButtonType.Normal }) {
      Row({ space: 12 }) {
        SymbolGlyph($$.symbol).fontSize(20).fontColor([this.colors.secondary]).width(24)
        Column({ space: 4 }) {
          Text($$.title).fontSize(16).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground)
            .width('100%').maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
          Row({ space: 6 }) {
            if ($$.marker !== undefined) { Circle().width(6).height(6).fill($$.marker) }
            Text($$.subtitle).fontSize(13)
              .fontColor($$.attention ? this.colors.attentionForeground : this.colors.secondary).maxLines(1)
            if ($$.stamp) {
              Text('·').fontSize(13).fontColor(this.colors.tertiary)
              Text($$.stamp).fontSize(13).fontColor(this.colors.tertiary).maxLines(1)
            }
          }.width('100%').alignItems(VerticalAlign.Center)
        }.layoutWeight(1).alignItems(HorizontalAlign.Start)
      }.width('100%').padding({ left: 12, right: 12, top: 8, bottom: 8 })
    }.width('100%').constraintSize({ minHeight: 58 }).padding(0)
      .backgroundColor(this.colors.light ? ($$.attention ? this.colors.attentionFill : this.colors.panel) : Color.Transparent)
      .border($$.attention ? this.colors.attentionStroke : this.colors.panelStroke).borderRadius(this.colors.corner(14))
      .onClick((): void => { $$.onOpen(); })
  }

  @Builder groupHeading(label: ResourceStr) {
    Text(label).fontSize(14).fontWeight(FontWeight.Medium).fontColor(this.colors.secondary)
      .width('100%').padding({ left: 8, right: 8, top: 12, bottom: 4 })
  }

  @Builder workRow(item: XopcPersonalWorkItem, attention: boolean = false) {
    Column() {
      this.entry({ title: item.title, subtitle: this.status(item), stamp: this.time(item.updatedAt),
        symbol: attention ? $r('sys.symbol.bell') : $r('sys.symbol.checkmark_circle'),
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

  @Builder tasks() {
    Column({ space: 3 }) {
      if (this.model.workLoading && !this.model.workLoaded) { XopcListSkeleton() }
      if (this.model.attentionCount > 0) {
        this.groupHeading($r('app.string.personal_overview_attention'))
        if (this.model.prompt) {
          this.entry({ title: this.model.prompt.question, subtitle: $r('app.string.personal_overview_attention'), stamp: '',
            symbol: $r('sys.symbol.bell'), marker: this.colors.attentionForeground, attention: true, onOpen: this.onClose })
        }
        ForEach(this.model.attention, (item: XopcPersonalWorkItem) => { this.workRow(item, true) },
          (item: XopcPersonalWorkItem): string => item.id)
      }
      if (this.model.active.length) {
        this.groupHeading($r('app.string.personal_overview_current'))
        ForEach(this.model.active, (item: XopcPersonalWorkItem) => { this.workRow(item) },
          (item: XopcPersonalWorkItem): string => item.id)
      }
      Row() {
        Text($r('app.string.personal_overview_schedules')).fontSize(14).fontWeight(FontWeight.Medium)
          .fontColor(this.colors.secondary).layoutWeight(1)
        Button($r('app.string.personal_overview_new_schedule')).id('personal-overview-new-schedule')
          .height(44).fontSize(14).fontColor(this.colors.foreground).backgroundColor(Color.Transparent)
          .enabled(!!this.record?.conversationId)
          .onClick((): void => { this.openScheduleSetup(); })
      }.width('100%').padding({ left: 8, right: 8, top: 8 })
      if (this.model.schedulesLoading && !this.model.schedules.length) {
        LoadingProgress().width(22).height(22).color(this.colors.secondary).margin({ left: 8 })
      }
      if (this.model.scheduleError) {
        Button($r('app.string.retry')).height(44).backgroundColor(Color.Transparent).fontColor(this.colors.accent)
          .onClick((): void => { void this.model.loadSchedules(); })
      }
      ForEach(this.model.schedules, (item: XopcAutomation) => { this.scheduleRow(item) },
        (item: XopcAutomation): string => item.id)
      if (this.model.schedulesLoaded && !this.model.schedulesLoading && !this.model.schedules.length && !this.model.scheduleError) {
        XopcAutomationIdeas({ onChoose: (prompt: string): void => { this.openScheduleSetup(prompt); } })
      }
      ForEach(this.model.groups, (group: XopcPersonalWorkGroup) => {
        Column({ space: 3 }) {
          this.groupHeading(this.historyTitle(group.id))
          ForEach(group.items, (item: XopcPersonalWorkItem) => { this.workRow(item) },
            (item: XopcPersonalWorkItem): string => item.id)
        }.width('100%')
      }, (group: XopcPersonalWorkGroup): string => group.id)
      if (this.model.workError || this.model.moreWork) {
        Button(this.model.workError ? $r('app.string.retry') : $r('app.string.load_more'))
          .height(44).width('100%').backgroundColor(Color.Transparent).fontColor(this.colors.accent).enabled(!this.model.workLoading)
          .onClick((): void => { void this.model.work(this.model.moreWork); })
      }
    }.id('personal-overview-task-list').width('100%').alignItems(HorizontalAlign.Start)
  }

  private openScheduleSetup(prompt: string = ''): void {
    if (!this.record?.conversationId) return;
    this.onNavigate({ page: 'automation-setup', itemId: '', personalSchedule: true, prompt });
  }

  @Builder library() {
    Column({ space: 6 }) {
      if (!this.model.deliveryLoaded && !this.model.deliveryError) { XopcListSkeleton() }
      ForEach(this.model.deliveries, (item: XopcPersonalDelivery) => {
        Column({ space: 2 }) {
          if (item.artifact?.availability === 'available' &&
            (item.artifact.workspaceRelativePath || item.artifact.uri?.startsWith('xopc-file:') ||
              item.artifact.uri?.startsWith('xopc-file-version:') || item.artifact.uri?.startsWith('media://'))) {
            XopcChatMediaView({ file: artifactMedia(item.artifact), conversationId: item.task?.conversationId ?? this.record?.conversationId ?? '',
              compact: true, embedded: true, compactAvailable: true, resultCapsule: true, showLibraryActions: false })
          } else {
            this.entry({ title: item.artifact?.title ?? item.reference?.title ?? $r('app.string.untitled'),
              subtitle: item.task?.title ?? $r('app.string.personal_overview_source'), stamp: this.time(item.createdAt),
              symbol: $r('sys.symbol.doc'), onOpen: (): void => { this.openDelivery(item); } })
          }
        }.id('personal-overview-delivery-' + item.id).width('100%').alignItems(HorizontalAlign.Start)
      }, (item: XopcPersonalDelivery): string => item.id)
      if (this.model.deliveryLoaded && !this.model.deliveries.length && !this.model.deliveryError && !this.model.deliveryLoading) {
        Text($r('app.string.personal_overview_no_deliveries')).fontSize(14).fontColor(this.colors.secondary)
          .textAlign(TextAlign.Center).width('100%').padding(20)
      }
      if (this.model.deliveryLoaded && this.model.deliveryLoading) {
        Row() { LoadingProgress().width(22).height(22).color(this.colors.secondary) }
          .id('personal-overview-library-loading-more').height(44).width('100%').justifyContent(FlexAlign.Center)
          .accessibilityText($r('app.string.loading'))
      } else if (this.model.deliveryError || this.model.nextDeliveryOffset !== null) {
        Button(this.model.deliveryError ? $r('app.string.retry') : $r('app.string.load_more'))
          .height(44).width('100%').backgroundColor(Color.Transparent).fontColor(this.colors.accent)
          .onClick((): void => {
            if (this.model.deliveryError) void this.model.retryDeliveries();
            else void this.model.loadDeliveries(true);
          })
      }
    }.id('personal-overview-library-list').width('100%').alignItems(HorizontalAlign.Start)
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
          .onClick((): void => { this.onNavigate({ page: 'personal-agent-profile', itemId: '' }); })
      }
      Text(this.record?.displayName ?? '').fontSize(24).fontWeight(FontWeight.Bold).fontColor(this.colors.foreground)
        .textAlign(TextAlign.Center).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
        .width('100%').padding({ left: 16, right: 16, top: 8 - 4 * this.headerProgress })
      Row({ space: 6 }) {
        if (this.model.attentionCount) {
          Circle().width(6).height(6).fill(this.colors.attentionForeground)
          Text($r('app.string.chat_attention_count', this.model.attentionCount)).fontSize(14)
            .fontColor(this.colors.attentionForeground)
        } else if (this.model.runningCount) {
          Circle().width(6).height(6).fill(this.colors.accent)
          Text($r('app.string.personal_overview_running', this.model.runningCount)).fontSize(14).fontColor(this.colors.secondary)
        }
      }.constraintSize({ minHeight: 24 }).margin({ top: 4 - 2 * this.headerProgress })
      Column() {
        XopcSegmentedTabs({ options: [
          { key: 'tasks', label: $r('app.string.tasks'), icon: $r('sys.symbol.checkmark_circle'), count: this.model.attentionCount || undefined, testId: 'personal-overview-tasks-tab' },
          { key: 'library', label: $r('app.string.personal_overview_library'), icon: $r('sys.symbol.doc_text'), testId: 'personal-overview-library-tab' }
        ], selectedKey: this.librarySelected ? 'library' : 'tasks',
          onSelect: (key: string): void => { this.selectLibrary(key === 'library'); } })
      }.width('100%').margin({ top: 14 - 6 * this.headerProgress, bottom: 8 })
      if (this.librarySelected) {
        Scroll() { this.library() }.width('100%').layoutWeight(1).scrollBar(BarState.Auto)
          .onWillScroll((x: number, y: number, _state: ScrollState, source: ScrollSource): OffsetResult =>
            this.scrollHeader(x, y, source))
      } else {
        Scroll() { this.tasks() }.width('100%').layoutWeight(1).scrollBar(BarState.Auto)
          .onWillScroll((x: number, y: number, _state: ScrollState, source: ScrollSource): OffsetResult =>
            this.scrollHeader(x, y, source))
      }
    }.id('personal-overview').width('100%').height('100%').constraintSize({ maxWidth: 640 })
      .padding({ left: 16, right: 16, bottom: 8 }).backgroundColor(this.colors.surface)
  }
}
