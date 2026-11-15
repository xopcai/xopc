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
        attention != nil || ["needs_user", "waiting_for_user", "blocked"].contains(presentation?.status ?? operationalState ?? phase)
    }

    var status: LocalizedStringKey {
        if requiresAttention {
            return "需要你处理"
        }
        return switch presentation?.status ?? operationalState ?? phase {
        case "paused": "已暂停"
        case "completed", "done", "closed": "已完成"
        case "running", "active", "in_progress": "进行中"
        case "failed": "执行失败"
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

struct PersonalAgentOverview: View {
    let configuration: GatewayConfiguration
    let agent: PersonalAgentRecord
    let attention: Int
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
    @State private var collapse: CGFloat = 0
    @State private var current: [PersonalOverviewWork] = []
    @State private var history: [PersonalOverviewWork] = []
    @State private var total = 0
    @State private var schedules: [AutomationRecord]?
    @State private var deliveries: [PersonalOverviewDelivery] = []
    @State private var nextDelivery: Int?
    @State private var workLoaded = false
    @State private var deliveryLoaded = false
    @State private var workLoading = false
    @State private var scheduleLoading = false
    @State private var deliveryLoading = false
    @State private var workError = false
    @State private var scheduleError = false
    @State private var deliveryError = false

    private enum SectionTab: Hashable { case tasks, library }

    var body: some View {
        VStack(spacing: 0) {
            top
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 10) {
                    Color.clear.frame(height: 1)
                        .onGeometryChange(for: CGFloat.self) {
                            min(1, max(0, -$0.frame(in: .named("personal-overview")).minY / 108))
                        } action: { collapse = $0 }
                    if tab == .tasks {
                        tasks
                    } else {
                        library
                    }
                }
                .padding(.horizontal, 18)
                .padding(.bottom, 22)
            }
            .coordinateSpace(name: "personal-overview")
            .accessibilityIdentifier("personal-overview-scroll")
            .refreshable {
                if tab == .tasks {
                    await refreshTasks()
                } else {
                    await loadDeliveries(reset: true)
                }
            }
        }
        .background(ChatAppearance.canvas(colorScheme))
        .toolbar(.hidden, for: .navigationBar)
        .task { await refreshTasks() }
        .task(id: tab) {
            if tab == .library, !deliveryLoaded {
                await loadDeliveries(reset: true)
            }
        }
        .modifier(AutomationSetupPresentation(configuration: configuration, scope: .personal,
                                              prompt: $setupPrompt, onClosed: { Task { await loadSchedules() } }))
        .sheet(isPresented: $showingEdit) {
            PersonalAgentProfileView(configuration: configuration, record: agent,
                                     conversation: .existing(id: agent.conversationId, title: agent.displayName, agentId: agent.agentId),
                                     onSaved: onEdit, onModelSaved: onModelSaved)
        }
    }

    private var top: some View {
        VStack(spacing: 8) {
            Button("关闭", systemImage: "xmark", action: { dismiss() })
                .labelStyle(.iconOnly)
                .frame(width: 44, height: 44)
                .frame(maxWidth: .infinity, alignment: .trailing)
                .accessibilityIdentifier("personal-overview-close")
            ZStack(alignment: .bottomTrailing) {
                PersonalAgentAvatar(configuration: configuration, agent: agent, size: 112 - 48 * collapse, active: !reduceMotion)
                    .accessibilityIdentifier("personal-overview-avatar")
                Button("编辑助手", systemImage: "pencil") { showingEdit = true }
                    .labelStyle(.iconOnly).frame(width: 44, height: 44)
                    .background(.regularMaterial, in: .circle)
            }
            Text(agent.displayName).font(.title2.weight(.semibold)).lineLimit(1)
            let count = workLoaded ? current.filter(\.requiresAttention).count : attention
            if count > 0 {
                Label { Text("有 \(count) 项待你处理") } icon: { Circle().fill(.orange).frame(width: 6, height: 6) }
                    .font(.subheadline).foregroundStyle(.secondary)
            }
            Picker("助理概览", selection: $tab) {
                Label("任务", systemImage: "checklist").tag(SectionTab.tasks)
                Label("资料库", systemImage: "doc.on.doc").tag(SectionTab.library)
            }
            .pickerStyle(.segmented)
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
        ForEach(deliveries) { item in
            let scope = item.task?.conversationId ?? agent.conversationId
            if let attachment = item.artifact?.attachment {
                ChatAttachmentPreview(attachment: attachment, configuration: configuration, conversationID: scope, capsule: true)
            } else {
                Button { openDelivery(item, conversationID: scope) } label: {
                    row(item.artifact?.title ?? item.reference?.title ?? item.task?.title ?? "",
                        subtitle: "成果", symbol: "doc")
                }
                .buttonStyle(.plain)
            }
        }
        if deliveryLoading {
            ProgressView().frame(maxWidth: .infinity, minHeight: 48)
        }
        if deliveryError {
            Button("重试") { Task { await loadDeliveries(reset: !deliveryLoaded) } }
        } else if deliveryLoaded, deliveries.isEmpty {
            ContentUnavailableView("暂无资料", systemImage: "doc.on.doc")
        } else if nextDelivery != nil {
            Button("加载更多") { Task { await loadDeliveries(reset: false) } }.disabled(deliveryLoading)
        }
    }

    private func taskRow(_ task: PersonalOverviewWork) -> some View {
        NavigationLink {
            TaskDetailView(configuration: configuration, taskID: task.id)
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
                Text(subtitle).font(.caption).foregroundStyle(attention ? Color.orange : Color.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        } icon: { Image(systemName: symbol).foregroundStyle(.secondary) }
            .frame(minHeight: 48)
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
                playback.play(track) {
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
        guard !deliveryLoading, let offset = reset ? 0 : nextDelivery else { return }
        deliveryLoading = true
        defer { deliveryLoading = false }
        do {
            let page = try await GatewayClient(configuration: configuration).personalOverviewDeliveries(offset: offset)
            try Task.checkCancellation()
            deliveries = reset ? page.items : deliveries + page.items.filter { item in !deliveries.contains { $0.id == item.id } }
            nextDelivery = page.nextOffset
            deliveryLoaded = true
            deliveryError = false
        } catch is CancellationError {} catch { deliveryError = true }
    }
}
