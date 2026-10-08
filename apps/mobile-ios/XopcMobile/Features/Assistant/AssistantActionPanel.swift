import SwiftUI

struct PersonalConnectionSnapshot: Decodable {
    let transcriptId: String
    let revision: Int
    let wait: PersonalConnectionWait?
}

struct PersonalConnectionWait: Decodable {
    struct Account: Decodable, Identifiable {
        let id: String
        let label: String
    }

    struct Need: Decodable, Identifiable {
        let key: String
        let label: String
        let phase: String
        let authorizationMode: String
        let accounts: [Account]
        let reason: String?
        var id: String {
            key
        }
    }

    let id: String
    let transcriptId: String
    let version: Int
    let summary: String
    let phase: String
    let needs: [Need]
    let timeRange: PersonalConnectionTimeRange?
}

struct PersonalConnectionTimeRange: Decodable {
    let from: String
    let end: String
    let timezone: String
    let expression: String

    enum CodingKeys: String, CodingKey {
        case from, timezone, expression
        case end = "to"
    }
}

private struct PersonalConnectionAction: Encodable {
    let waitId: String
    let expectedTranscriptId: String
    let expectedVersion: Int
    let idempotencyKey: String
    let action: String
    var needKey: String?
    var accountId: String?
}

private struct PersonalConnectionActionResult: Decodable {
    let snapshot: PersonalConnectionSnapshot
    let authorizationUrl: String?
}

extension GatewayClient {
    func fetchPersonalConnection(conversationID: String) async throws -> PersonalConnectionSnapshot {
        let envelope: GatewayEnvelope<PersonalConnectionSnapshot> = try await request(
            path: "/api/sessions/\(conversationID)/connection-wait"
        )
        guard envelope.isSuccessful, let payload = envelope.payload else {
            throw GatewayClientError.server(envelope.error?.message ?? "无法读取连接状态")
        }
        return payload
    }

    fileprivate func actOnPersonalConnection(
        conversationID: String, wait: PersonalConnectionWait, action: String,
        needKey: String?, accountID: String?
    ) async throws -> PersonalConnectionActionResult {
        let command = PersonalConnectionAction(
            waitId: wait.id, expectedTranscriptId: wait.transcriptId, expectedVersion: wait.version,
            idempotencyKey: UUID().uuidString, action: action, needKey: needKey, accountId: accountID
        )
        let envelope: GatewayEnvelope<PersonalConnectionActionResult> = try await request(
            path: "/api/sessions/\(conversationID)/connection-wait/actions",
            method: "POST", body: encoder.encode(command)
        )
        guard envelope.isSuccessful, let payload = envelope.payload else {
            throw GatewayClientError.server(envelope.error?.message ?? "无法完成连接操作")
        }
        return payload
    }
}

struct PersonalConnectionCard: View {
    let configuration: GatewayConfiguration
    let conversationID: String

    @Environment(\.openURL) private var openURL
    @Environment(\.scenePhase) private var scenePhase
    @State private var snapshot: PersonalConnectionSnapshot?
    @State private var isSubmitting = false
    @State private var errorMessage: String?

    private struct ObservationKey: Equatable {
        let configuration: GatewayConfiguration
        let conversationID: String
        let isActive: Bool
    }

    var body: some View {
        Group {
            if let wait = snapshot?.wait {
                VStack(alignment: .leading, spacing: 12) {
                    Label("连接应用后继续", systemImage: "link")
                        .font(.headline)
                    Text(verbatim: wait.summary).font(.subheadline)
                    if let range = wait.timeRange {
                        Text(verbatim: "\(range.from) — \(range.end) · \(range.timezone)")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    ForEach(wait.needs) { need in
                        needActions(need, wait: wait)
                    }
                    if wait.phase == "review_scope" {
                        Button("确认查询范围并继续") { act("confirm_scope", wait: wait) }
                            .buttonStyle(.borderedProminent)
                    }
                    if let errorMessage {
                        Text(verbatim: errorMessage).font(.caption).foregroundStyle(.red)
                    }
                    HStack {
                        Button("检查连接状态") { act("check", wait: wait) }
                        Spacer()
                        Button("取消请求", role: .cancel) { act("cancel", wait: wait) }
                    }
                    .font(.subheadline)
                }
                .disabled(isSubmitting)
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(.quaternary, in: .rect(cornerRadius: 14))
            }
        }
        .task(id: ObservationKey(configuration: configuration, conversationID: conversationID,
                                 isActive: scenePhase == .active))
        {
            guard scenePhase == .active else { return }
            while !Task.isCancelled {
                await refresh()
                do { try await Task.sleep(for: .seconds(3)) }
                catch { return }
            }
        }
    }

    private func needActions(_ need: PersonalConnectionWait.Need, wait: PersonalConnectionWait) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(verbatim: need.label).font(.subheadline.bold())
            if need.phase == "choose_account" {
                ForEach(need.accounts) { account in
                    Button { act("select_account", wait: wait, needKey: need.key, accountID: account.id) } label: {
                        Text(verbatim: account.label)
                    }
                    .buttonStyle(.bordered)
                }
            } else if need.phase == "connect" || need.phase == "reconnect" {
                if need.authorizationMode == "browser" {
                    Button(need.phase == "reconnect" ? "重新授权" : "连接") {
                        act("connect", wait: wait, needKey: need.key)
                    }
                    .buttonStyle(.borderedProminent)
                } else {
                    Text("请在桌面端完成连接设置").font(.caption).foregroundStyle(.secondary)
                }
            } else if need.phase == "authorizing" {
                Text("完成浏览器授权后会自动继续").font(.caption).foregroundStyle(.secondary)
            } else if let reason = need.reason {
                Text(verbatim: reason).font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    private func act(_ action: String, wait: PersonalConnectionWait, needKey: String? = nil, accountID: String? = nil) {
        guard !isSubmitting else { return }
        isSubmitting = true
        errorMessage = nil
        Task { @MainActor in
            defer { isSubmitting = false }
            do {
                let result = try await GatewayClient(configuration: configuration).actOnPersonalConnection(
                    conversationID: conversationID, wait: wait, action: action, needKey: needKey, accountID: accountID
                )
                snapshot = result.snapshot
                if let rawURL = result.authorizationUrl, let url = URL(string: rawURL),
                   url.scheme == "https", url.user == nil, url.password == nil
                {
                    openURL(url)
                }
            } catch is CancellationError {
                return
            } catch {
                errorMessage = error.localizedDescription
                isSubmitting = false
                await refresh()
            }
        }
    }

    @MainActor
    private func refresh() async {
        guard !isSubmitting else { return }
        do {
            snapshot = try await GatewayClient(configuration: configuration).fetchPersonalConnection(conversationID: conversationID)
        } catch is CancellationError {
            return
        } catch {
            if snapshot?.wait != nil {
                errorMessage = error.localizedDescription
            }
        }
    }
}

enum AssistantAction: String, CaseIterable, Identifiable {
    case photo, camera, localFile, voice
    case noteReference, taskReference, fileReference, newConversation

    var id: String {
        rawValue
    }

    var title: LocalizedStringKey {
        switch self {
        case .photo: "照片"
        case .camera: "拍照"
        case .localFile: "本地文件"
        case .voice: "语音输入"
        case .noteReference: "引用笔记"
        case .taskReference: "引用任务"
        case .fileReference: "引用文件"
        case .newConversation: "新建会话"
        }
    }

    var systemImage: String {
        switch self {
        case .photo: "photo"
        case .camera: "camera"
        case .localFile, .fileReference: "folder"
        case .voice: "mic"
        case .noteReference: "doc"
        case .taskReference: "checkmark.circle"
        case .newConversation: "square.and.pencil"
        }
    }

    var referenceKind: ContextReferenceKind? {
        switch self {
        case .noteReference: .note
        case .taskReference: .task
        case .fileReference: .file
        default: nil
        }
    }
}

struct AssistantActionPanel: View {
    let canReferenceFiles: Bool
    let canStartRealtimeVoice: Bool
    let onSelect: (AssistantAction) -> Void
    let onRealtimeVoice: (RealtimeVoiceMode) -> Void

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    private var columns: [GridItem] {
        Array(repeating: GridItem(.flexible(), spacing: 8), count: dynamicTypeSize.isAccessibilitySize ? 2 : 4)
    }

    var body: some View {
        TabView {
            LazyVGrid(columns: columns, spacing: 18) {
                ForEach(AssistantAction.allCases) { action in
                    Button {
                        onSelect(action)
                    } label: {
                        tile(title: Text(action.title), image: action.systemImage)
                    }
                    .buttonStyle(.plain)
                    .disabled(action == .fileReference && !canReferenceFiles)
                    .accessibilityLabel(action.title)
                    .accessibilityHint(action == .fileReference && !canReferenceFiles
                        ? AppLocalization.string("发送第一条消息后可引用文件", locale: AppLocalization.selectedLocale)
                        : "")
                }
            }
            .padding(.horizontal, 8)
            .padding(.top, 8)

            HStack(alignment: .top, spacing: 8) {
                ForEach(RealtimeVoiceMode.allCases, id: \.self) { mode in
                    Button { onRealtimeVoice(mode) } label: {
                        tile(title: Text(mode.title), image: mode == .natural ? "waveform" : "speaker.wave.2")
                    }
                    .buttonStyle(.plain)
                    .disabled(!canStartRealtimeVoice)
                    .accessibilityLabel(Text(mode.title))
                    .accessibilityHint(canStartRealtimeVoice
                        ? ""
                        : AppLocalization.string("请先打开对话或等待语音准备完成", locale: AppLocalization.selectedLocale))
                    .frame(maxWidth: .infinity)
                }
                ForEach(0 ..< 2, id: \.self) { _ in Color.clear.frame(maxWidth: .infinity) }
            }
            .padding(.horizontal, 8)
            .padding(.top, 8)
        }
        .tabViewStyle(.page(indexDisplayMode: .always))
        .frame(height: dynamicTypeSize.isAccessibilitySize ? 258 : 205)
        .background(Color(uiColor: .secondarySystemGroupedBackground), in: .rect(cornerRadius: 18))
        .padding(.bottom, 8)
        .accessibilityIdentifier("assistant-action-panel")
    }

    private func tile(title: Text, image: String) -> some View {
        VStack(spacing: 7) {
            Image(systemName: image)
                .font(.system(size: 23, weight: .regular))
                .frame(width: 54, height: 54)
                .background(Color(uiColor: .systemGray5), in: .rect(cornerRadius: 15))
            title
                .font(.caption)
                .lineLimit(dynamicTypeSize.isAccessibilitySize ? 2 : 1)
        }
        .foregroundStyle(.primary)
        .frame(maxWidth: .infinity)
        .contentShape(.rect)
    }
}
