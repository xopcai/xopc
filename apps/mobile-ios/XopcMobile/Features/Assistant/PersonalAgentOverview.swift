import SwiftUI

struct PersonalOverviewWork: Decodable, Identifiable, Sendable {
    let id: String
    let title: String
    let phase: String
    let operationalState: String?
    let updatedAt: Double
    let attention: Attention?
    let presentation: Presentation?

    struct Attention: Decodable, Sendable { let kind: String }
    struct Presentation: Decodable, Sendable { let status: String }

    var requiresAttention: Bool {
        let current = presentation?.status ?? operationalState ?? phase
        return attention != nil || ["needsUser", "review", "needs_user", "waiting_for_user", "blocked", "failed"].contains(current)
    }

    var status: LocalizedStringKey {
        let current = presentation?.status ?? operationalState ?? phase
        if current == "review" {
            return "等待验收"
        }
        if current == "failed" {
            return "执行失败"
        }
        if requiresAttention {
            return "需要你处理"
        }
        return switch current {
        case "allocating": "正在分配"
        case "captured", "backlog": "待规划"
        case "ready": "等待开始"
        case "queued": "排队中"
        case "running", "active", "in_progress": "进行中"
        case "verifying": "验证中"
        case "waiting": "等待条件"
        case "paused": "已暂停"
        case "completed", "done": "已完成"
        case "ended", "closed": "已结束"
        case "cancelled": "已取消"
        default: "待处理"
        }
    }
}

struct PersonalOverviewWorkPage: Decodable, Sendable {
    let current: [PersonalOverviewWork]
    let items: [PersonalOverviewWork]
    let total: Int
}

struct PersonalOverviewDelivery: Decodable, Identifiable, Sendable {
    struct Task: Decodable, Sendable { let id: String; let title: String; let conversationId: String? }
    struct Artifact: Decodable, Sendable {
        let artifactId: String
        let title: String
        let mimeType: String?
        let sizeBytes: Int?
        let workspaceRelativePath: String?
        let uri: String?
        let availability: String?

        var attachment: HistoryAttachment? {
            guard availability == "available" else { return nil }
            let managed = uri.flatMap(ChatMessageLink.resolve)
            let isFile = switch managed {
            case .managedFile: true
            default: false
            }
            guard workspaceRelativePath != nil || isFile || uri?.hasPrefix("media://") == true
                || uri?.hasPrefix("xopc-file-version:") == true else { return nil }
            return HistoryAttachment(mediaID: artifactId, type: nil, name: title, mimeType: mimeType, size: sizeBytes,
                                     uri: uri, duration: nil, workspaceRelativePath: workspaceRelativePath, extractedText: nil)
        }
    }

    let id: String
    let task: Task?
    let artifact: Artifact?
    let reference: HistoryProductReference?
}

struct PersonalOverviewDeliveryPage: Decodable, Sendable {
    let items: [PersonalOverviewDelivery]
    let nextOffset: Int?
}

extension GatewayClient {
    private func personalOverviewPayload<T: Decodable>(path: String, query: [URLQueryItem] = []) async throws -> T {
        let envelope: GatewayEnvelope<T> = try await request(path: path, queryItems: query)
        guard envelope.isSuccessful, let payload = envelope.payload else {
            throw GatewayClientError.server(envelope.error?.message ?? AppLocalization.resolve("无法读取助理概览"))
        }
        return payload
    }

    func personalOverviewWork(offset: Int) async throws -> PersonalOverviewWorkPage {
        try await personalOverviewPayload(path: "/api/personal-agent/activity", query: [
            .init(name: "view", value: "work"), .init(name: "limit", value: "10"),
            .init(name: "offset", value: String(offset))
        ])
    }

    func personalOverviewDeliveries(offset: Int) async throws -> PersonalOverviewDeliveryPage {
        let page: PersonalOverviewDeliveryPage = try await personalOverviewPayload(path: "/api/personal-agent/activity", query: [
            .init(name: "view", value: "deliverables"), .init(name: "limit", value: "15"),
            .init(name: "offset", value: String(offset))
        ])
        if let next = page.nextOffset, next <= offset {
            throw GatewayClientError.invalidResponse
        }
        return page
    }

    func personalOverviewSchedules() async throws -> [AutomationRecord] {
        try await personalOverviewPayload(path: "/api/personal-agent/schedules")
    }
}

// swiftlint:disable:next type_body_length
struct PersonalAgentOverview: View {
    @Environment(\.mobileTheme) private var mobileTheme
    let configuration: GatewayConfiguration
    let agent: PersonalAgentRecord
    let conversation: ConversationSelection
    let attention: Int
    let allowsConversationSharing: Bool
    let onEdit: (PersonalAgentRecord) -> Void
    let onModelSaved: (ConversationSelection) -> Void
    let onOpenConversation: (String, String, String) -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorScheme) private var colorScheme
    @State private var showingEdit = false
    @State private var setupPrompt: String?
    @State private var tab = SectionTab.tasks
    @State private var pagerProgress = PageScrollProgress()
    @State private var collapse: CGFloat = 0
    @State private var current: [PersonalOverviewWork] = []
    @State private var history: [PersonalOverviewWork] = []
    @State private var total = 0
    @State private var schedules: [AutomationRecord]?
    @State private var deliveries: [PersonalOverviewDelivery] = []
    @State private var nextDelivery: Int?
    @State private var workLoaded = false
    @State private var deliveryLoaded = false
    @State private var libraryOpened = false
    @State private var workLoading = false
    @State private var scheduleLoading = false
    @State private var deliveryLoadingOffset: Int?
    @State private var workError = false
    @State private var scheduleError = false
    @State private var deliveryRetryReset: Bool?

    private enum SectionTab: CaseIterable, Hashable { case tasks, library }

    var body: some View {
        VStack(spacing: 0) {
            top
            MobilePagePager(pages: SectionTab.allCases, selection: $tab, progress: pagerProgress) { page in
                overviewPage(page)
            }
            .accessibilityIdentifier("personal-overview-pager")
        }
        .background(mobileTheme.canvas)
        .toolbar(.hidden, for: .navigationBar)
        .task { await refreshTasks() }
        .onChange(of: tab) {
            if tab == .library {
                libraryOpened = true
            }
        }
        .task(id: libraryOpened) {
            if libraryOpened, !deliveryLoaded, deliveryRetryReset == nil {
                await loadDeliveries(reset: true)
            }
        }
        .modifier(AutomationSetupPresentation(configuration: configuration, scope: .personal,
                                              prompt: $setupPrompt, onClosed: { Task { await loadSchedules() } }))
        .sheet(isPresented: $showingEdit) {
            PersonalAgentProfileView(configuration: configuration, record: agent,
                                     conversation: conversation,
                                     onSaved: onEdit, onModelSaved: onModelSaved,
                                     allowsConversationSharing: allowsConversationSharing)
                .mobileSheetPreset(.large)
        }
    }

    private func overviewPage(_ page: SectionTab) -> some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 10) {
                Color.clear.frame(height: 1)
                    .onGeometryChange(for: CGFloat?.self) { proxy in
                        guard page == tab else { return nil }
                        return min(1, max(0, -proxy.frame(in: .named(page)).minY / 108))
                    } action: {
                        if let amount = $0 {
                            collapse = amount
                        }
                    }
                if page == .tasks {
                    tasks
                } else {
                    library
                }
            }
            .padding(.horizontal, 18)
            .padding(.bottom, 22)
        }
        .coordinateSpace(name: page)
        .accessibilityIdentifier("personal-overview-scroll")
        .refreshable {
            if page == .tasks {
                await refreshTasks()
            } else {
                await loadDeliveries(reset: true)
            }
        }
    }

    private var top: some View {
        VStack(spacing: 8) {
            MobileHeaderIconButton("关闭", systemImage: "xmark", size: 44) { dismiss() }
                .frame(maxWidth: .infinity, alignment: .trailing)
                .accessibilityIdentifier("personal-overview-close")
            Button { showingEdit = true } label: {
                PersonalAgentAvatar(configuration: configuration, agent: agent, size: 112 - 48 * collapse, active: !reduceMotion)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("编辑助手")
            .accessibilityIdentifier("personal-overview-avatar")
            Text(agent.displayName).font(.title2.weight(.semibold)).lineLimit(1)
            let count = workLoaded ? current.filter(\.requiresAttention).count : attention
            if count > 0 {
                Label { Text("有 \(count) 项待你处理") } icon: { Circle().fill(mobileTheme.onAttention).frame(width: 6, height: 6) }
                    .font(.subheadline).foregroundStyle(.secondary)
            }
            SegmentedTabs(options: [
                SegmentOption(id: SectionTab.tasks, title: "任务", icon: "checklist", count: count > 0 ? count : nil, accessibilityID: "personal-overview-tasks-tab"),
                SegmentOption(id: .library, title: "资料库", icon: "doc.on.doc", accessibilityID: "personal-overview-library-tab")
            ], selected: tab, label: "助理概览", swipeToSelect: !showingEdit && setupPrompt == nil, pagerProgress: pagerProgress) { next in
                withAnimation(reduceMotion ? nil : .easeOut(duration: 0.23)) { tab = next }
            }
            .accessibilityIdentifier("personal-overview-tabs")
            .padding(.top, 8)
        }
        .padding(.horizontal, 18)
        .padding(.bottom, 8)
    }

    @ViewBuilder private var tasks: some View {
        if !workLoaded, !workError {
            ProgressView().frame(maxWidth: .infinity, minHeight: 64)
        }
        if workError {
            Button("重试") { Task { await loadWork(reset: !workLoaded) } }
                .accessibilityIdentifier("personal-overview-work-retry")
        }
        let attentionItems = current.filter(\.requiresAttention)
        let active = current.filter { !$0.requiresAttention }
        if !attentionItems.isEmpty {
            heading("待你处理")
            ForEach(attentionItems) { taskRow($0) }
        }
        if !active.isEmpty {
            heading("当前任务")
            ForEach(active) { taskRow($0) }
        }
        if workLoaded, current.isEmpty, history.isEmpty {
            Text("暂无任务").foregroundStyle(.secondary)
        }
        HStack {
            heading("定时任务")
            Spacer()
            Button("新建", systemImage: "plus") { setupPrompt = "" }
                .disabled(setupPrompt != nil)
                .accessibilityIdentifier("personal-schedule-create")
        }
        if scheduleLoading, schedules == nil {
            ProgressView().frame(maxWidth: .infinity, minHeight: 44)
        } else if scheduleError {
            Button("重试") { Task { await loadSchedules() } }
        } else if let schedules {
            if schedules.isEmpty {
                AutomationExamples(scope: .personal) { setupPrompt = $0 }
            } else {
                ForEach(schedules) { schedule in
                    NavigationLink {
                        AutomationDetailView(configuration: configuration, automationID: schedule.id, onOpenConversation: onOpenConversation)
                    } label: {
                        row(schedule.name, subtitle: schedule.enabled ? "已启用" : "已暂停", symbol: "clock")
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        if !history.isEmpty {
            heading("任务历史")
            let grouped = Dictionary(grouping: history) { Calendar.current.startOfDay(for: Date(timeIntervalSince1970: $0.updatedAt / 1000)) }
            ForEach(grouped.keys.sorted(by: >), id: \.self) { date in
                Text(date, format: .dateTime.month().day()).font(.caption).foregroundStyle(.secondary)
                ForEach(grouped[date] ?? []) { taskRow($0) }
            }
        }
        if history.count < total {
            Button("加载更多") { Task { await loadWork(reset: false) } }.disabled(workLoading)
        }
    }

    @ViewBuilder private var library: some View {
        if !deliveryLoaded, deliveryRetryReset == nil {
            librarySkeleton
        }
        ForEach(deliveries) { item in
            let scope = item.task?.conversationId ?? agent.conversationId
            if let attachment = item.artifact?.attachment {
                ChatAttachmentPreview(attachment: attachment, configuration: configuration, conversationID: scope,
                                      capsule: true, showLibraryActions: false)
            } else {
                Button { openDelivery(item, conversationID: scope) } label: {
                    row(item.artifact?.title ?? item.reference?.title ?? item.task?.title ?? "",
                        subtitle: "成果", symbol: "doc")
                }
                .buttonStyle(.plain)
            }
        }
        if let offset = deliveryLoadingOffset, offset > 0 {
            ProgressView().controlSize(.small).frame(maxWidth: .infinity, minHeight: 44)
                .accessibilityIdentifier("personal-overview-library-loading-more")
        } else if let reset = deliveryRetryReset {
            Button("重试") { Task { await loadDeliveries(reset: reset) } }
                .frame(maxWidth: .infinity, minHeight: 44)
        } else if deliveryLoaded, deliveries.isEmpty, deliveryLoadingOffset == nil {
            ContentUnavailableView("暂无资料", systemImage: "doc.on.doc")
        } else if nextDelivery != nil {
            Button("加载更多") { Task { await loadDeliveries(reset: false) } }
                .frame(maxWidth: .infinity, minHeight: 44)
                .disabled(deliveryLoadingOffset != nil)
        }
    }

    private var librarySkeleton: some View {
        MobileListSkeleton(rows: 3)
            .padding(.horizontal, 8)
            .accessibilityLabel("正在读取文件…")
            .accessibilityIdentifier("personal-overview-library-loading")
    }

    private func taskRow(_ task: PersonalOverviewWork) -> some View {
        NavigationLink {
            TaskConversationView(configuration: configuration, taskID: task.id)
        } label: {
            row(task.title, subtitle: task.status, symbol: "checkmark.circle", attention: task.requiresAttention)
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("personal-overview-task-\(task.id)")
    }

    private func row(_ title: String, subtitle: LocalizedStringKey, symbol: String, attention: Bool = false) -> some View {
        Label {
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.subheadline.weight(.semibold)).lineLimit(2)
                Text(subtitle).font(.caption).foregroundStyle(attention ? mobileTheme.onAttention : mobileTheme.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        } icon: { Image(systemName: symbol).foregroundStyle(.secondary) }
            .frame(minHeight: 48)
            .padding(.horizontal, 10)
            .background(attention ? mobileTheme.attention : Color.clear, in: .rect(cornerRadius: mobileTheme.corner(14)))
            .contentShape(.rect)
    }

    private func heading(_ title: LocalizedStringKey) -> some View {
        Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
            .padding(.top, 8).accessibilityAddTraits(.isHeader)
    }

    private func openDelivery(_ item: PersonalOverviewDelivery, conversationID: String) {
        if let reference = item.reference, openTarget(reference.kind, id: reference.id) {
            return
        }
        if let artifact = item.artifact, artifact.availability == "available",
           let uri = artifact.uri, uri == "/api/music-generation/sessions/\(conversationID)/jobs/\(artifact.artifactId)/audio",
           UUID(uuidString: conversationID) != nil,
           !artifact.artifactId.isEmpty, artifact.artifactId.utf8.allSatisfy({
               (48 ... 57).contains($0) || (65 ... 90).contains($0) || (97 ... 122).contains($0) || $0 == 45 || $0 == 95
           })
        {
            let playback = GeneratedMusicPlayback.shared
            let track = GeneratedMusicTrack(configurationScope: ComposerDraftStore.accountScope(configuration),
                                            conversationID: conversationID, id: artifact.artifactId, title: artifact.title,
                                            source: item.task?.title ?? agent.displayName, lyrics: nil, duration: nil)
            if playback.track?.key != track.key {
                playback.play(track, streaming: {
                    try await GatewayClient(configuration: configuration).mediaPlaybackURL(path: uri)
                }) {
                    try await GatewayClient(configuration: configuration).downloadGeneratedMedia(path: uri, fileName: "music.mp3")
                }
            }
            playback.expanded = true
        } else if let task = item.task {
            _ = openTarget("task", id: task.id)
        } else {
            onOpenConversation(conversationID, agent.displayName, agent.agentId)
        }
    }

    private func openTarget(_ kind: String, id: String) -> Bool {
        var components = URLComponents()
        components.scheme = "xopc"; components.host = "open"
        components.queryItems = [.init(name: "kind", value: kind), .init(name: "id", value: id)]
        guard let url = components.url, ChatMessageLink.resolve(url.absoluteString) != nil else { return false }
        openURL(url)
        return true
    }

    private func refreshTasks() async {
        async let work: Void = loadWork(reset: true)
        async let schedules: Void = loadSchedules()
        _ = await (work, schedules)
    }

    private func loadWork(reset: Bool) async {
        guard !workLoading else { return }
        workLoading = true
        defer { workLoading = false }
        do {
            let page = try await GatewayClient(configuration: configuration).personalOverviewWork(offset: reset ? 0 : history.count)
            try Task.checkCancellation()
            current = page.current
            history = reset ? page.items : history + page.items.filter { item in !history.contains { $0.id == item.id } }
            total = page.total
            workError = false
            workLoaded = true
        } catch is CancellationError {} catch { workError = true }
    }

    private func loadSchedules() async {
        guard !scheduleLoading else { return }
        scheduleLoading = true
        defer { scheduleLoading = false }
        do {
            let items = try await GatewayClient(configuration: configuration).personalOverviewSchedules()
            try Task.checkCancellation()
            schedules = items.sorted {
                let left = $0.state?.nextRunAtMs ?? .max
                let right = $1.state?.nextRunAtMs ?? .max
                return left == right ? $0.updatedAtMs > $1.updatedAtMs : left < right
            }
            scheduleError = false
        } catch is CancellationError {} catch { scheduleError = true }
    }

    private func loadDeliveries(reset: Bool) async {
        guard deliveryLoadingOffset == nil, let offset = reset ? 0 : nextDelivery else { return }
        deliveryLoadingOffset = offset
        deliveryRetryReset = nil
        defer { deliveryLoadingOffset = nil }
        do {
            let page = try await GatewayClient(configuration: configuration).personalOverviewDeliveries(offset: offset)
            try Task.checkCancellation()
            deliveries = reset ? page.items : deliveries + page.items.filter { item in !deliveries.contains { $0.id == item.id } }
            nextDelivery = page.nextOffset
            deliveryLoaded = true
        } catch is CancellationError {} catch { deliveryRetryReset = reset }
    }
}
