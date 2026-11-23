import AVKit
import SwiftUI

struct GeneratedMediaPayload: Decodable, Equatable, Sendable {
    let id: String
    let transcriptId: String?
    let title: String?
    let summary: String?
    let prompt: String?
    let lyrics: String?
    let state: String?
    let durationMs: Int?
    let duration: Int?
    let resolution: String?
    let ratio: String?
    let revision: Int?
    let estimatedCostFen: Int?
    let estimatedCreditMicro: Int?
    let versionNumber: Int?
    let error: String?
    let modelRef: String?
    let createdAt: Double
    let draftCreatedAt: Double?
}

struct GeneratedMediaCard: Identifiable, Equatable, Sendable {
    enum Kind: String, Sendable { case music, video }
    let kind: Kind
    let item: GeneratedMediaPayload
    var id: String {
        item.id
    }

    var title: String {
        item.title ?? item.summary ?? AppLocalization.resolve(kind == .music ? "音乐" : (isDraft ? "视频草稿" : "视频"))
    }

    var isDraft: Bool {
        item.revision != nil && item.state == nil
    }

    var completed: Bool {
        item.state == "completed"
    }

    var active: Bool {
        ["queued", "submitting", "submitted", "running", "saving"].contains(item.state ?? "")
    }

    var order: Double {
        item.draftCreatedAt ?? item.createdAt
    }

    var status: String {
        switch item.state {
        case "queued", "submitted": AppLocalization.resolve("排队中")
        case "submitting": AppLocalization.resolve("提交中")
        case "running", "saving": AppLocalization.resolve("生成中")
        case "failed": AppLocalization.resolve("生成失败")
        case "submission_unknown": AppLocalization.resolve("提交结果待确认")
        case "completed": AppLocalization.resolve("可播放")
        default: AppLocalization.resolve("待确认")
        }
    }

    var symbol: String {
        kind == .music ? "music.note" : "film"
    }

    var cardSubtitle: String {
        guard kind == .music else { return status }
        let version = item.versionNumber.map { AppLocalization.resolve("第 \($0) 版") }
        let length = item.durationMs.map { formatGeneratedMediaTime(Double($0) / 1000) }
        return [status, version, length].compactMap(\.self).joined(separator: " · ")
    }

    func jobsPath(_ conversationID: String) -> String {
        "/api/\(kind.rawValue)-generation/sessions/\(conversationID)/jobs"
    }

    func artifactPath(_ conversationID: String) -> String {
        jobsPath(conversationID) + "/\(id)/" + (kind == .music ? "audio" : "video")
    }
}

private struct GeneratedMediaResponse: Decodable {
    let jobs: [GeneratedMediaPayload]
    let draft: GeneratedMediaPayload?
    let transcriptId: String?
    let configured: Bool
    let modelRef: String?
}

@MainActor @Observable
final class GeneratedMediaState {
    private(set) var cards: [GeneratedMediaCard] = []
    private(set) var canConfirm = false
    private(set) var submitting = false
    private(set) var error: String?
    struct Scope: Equatable {
        let id: String
        let transcriptID: String
        let account: String

        var cacheKey: String {
            [account, id, transcriptID].joined(separator: ":")
        }

        func accepts(_ transcriptID: String?) -> Bool {
            transcriptID == nil || transcriptID == self.transcriptID
        }
    }

    private var scope: Scope?
    private var videoRequest = 0

    func cards(in requestedScope: Scope?) -> [GeneratedMediaCard] {
        guard let requestedScope else { return [] }
        if scope == requestedScope {
            return cards
        }
        return MobileListCache.shared.read(.generatedMedia, scope: requestedScope.cacheKey) ?? []
    }

    func observe(_ next: Scope?, client: GatewayClient, visible: Bool, busy: Bool) async {
        guard !Task.isCancelled else { return }
        if next != scope {
            cards = cards(in: next)
            scope = next
            error = nil
            canConfirm = false
            submitting = false
            videoRequest += 1
        }
        guard visible, let next else { return }
        while !Task.isCancelled {
            let request = videoRequest
            async let music: Void = refreshMusic(next, client: client)
            async let video: Void = refreshVideo(next, client: client, request: request)
            _ = await (music, video)
            try? await Task.sleep(for: .seconds(busy || cards.contains(where: \.active) ? 3 : 20))
        }
    }

    private func refreshMusic(_ scope: Scope, client: GatewayClient) async {
        guard let result = await fetch(.music, id: scope.id, client: client),
              !Task.isCancelled, self.scope == scope, scope.accepts(result.transcriptId) else { return }
        replace(.music, with: result.jobs)
    }

    private func refreshVideo(_ scope: Scope, client: GatewayClient, request: Int) async {
        guard let result = await fetch(.video, id: scope.id, client: client),
              !Task.isCancelled, self.scope == scope, scope.accepts(result.transcriptId),
              request == videoRequest, !submitting else { return }
        applyVideo(result)
    }

    private func fetch(_ kind: GeneratedMediaCard.Kind, id: String, client: GatewayClient) async -> GeneratedMediaResponse? {
        try? await client.request(path: "/api/\(kind.rawValue)-generation/sessions/\(id)/jobs")
    }

    private func applyVideo(_ response: GeneratedMediaResponse) {
        canConfirm = response.configured && response.modelRef != nil && response.draft?.modelRef == response.modelRef
        let jobs = response.jobs.filter { $0.transcriptId == response.transcriptId }
        let draft = response.draft.flatMap { draft in jobs.contains { $0.id == draft.id } ? nil : draft }
        replace(.video, with: jobs + (draft.map { [$0] } ?? []))
    }

    private func replace(_ kind: GeneratedMediaCard.Kind, with items: [GeneratedMediaPayload]) {
        let incoming = Set(items.map(\.id))
        let next = (cards.filter { $0.kind != kind || (!$0.isDraft && !incoming.contains($0.id)) }
            + items.map { GeneratedMediaCard(kind: kind, item: $0) })
            .sorted { ($0.order, $0.id) < ($1.order, $1.id) }
        if next != cards {
            cards = next
        }
        if let scope {
            MobileListCache.shared.write(next, to: .generatedMedia, scope: scope.cacheKey, requestedAt: .now)
        }
    }

    func confirm(_ card: GeneratedMediaCard, conversationID: String, client: GatewayClient) async {
        guard !submitting, let scope, scope.id == conversationID,
              scope.account == ComposerDraftStore.accountScope(client.configuration), card.isDraft, canConfirm,
              let revision = card.item.revision else { return }
        submitting = true
        error = nil
        videoRequest += 1
        let request = videoRequest
        defer {
            if self.scope == scope, videoRequest == request {
                submitting = false
            }
        }
        do {
            let job: GeneratedMediaPayload = try await client.request(
                path: card.jobsPath(conversationID) + "/confirm-draft", method: "POST",
                body: client.encoder.encode(GeneratedDraftConfirmation(id: card.id, revision: revision))
            )
            guard self.scope == scope, videoRequest == request, scope.accepts(job.transcriptId) else { return }
            replace(.video, with: cards.filter { $0.kind == .video && $0.id != job.id && !$0.isDraft }.map(\.item) + [job])
        } catch {
            guard self.scope == scope, videoRequest == request else { return }
            self.error = error.localizedDescription
            if let response = await fetch(.video, id: conversationID, client: client),
               self.scope == scope, videoRequest == request, scope.accepts(response.transcriptId)
            {
                applyVideo(response)
            }
        }
    }

    static func cardsByReply(_ cards: [GeneratedMediaCard], messages: [TimelineMessage]) -> [String: [GeneratedMediaCard]] {
        guard !cards.isEmpty else { return [:] }
        let replies = messages.filter { $0.role == "assistant" && $0.answerConfirmed }
        var anchors: [String: String] = [:]
        for reply in replies {
            for id in reply.generatedMediaIds where anchors[id] == nil {
                anchors[id] = reply.id
            }
        }
        // An older song belongs with its reply, which may be on another page of history.
        let visibleCards = cards.filter { $0.kind != .music || $0.active || anchors[$0.id] != nil }
        return Dictionary(grouping: visibleCards) { anchors[$0.id] ?? "" }
    }
}

private struct GeneratedDraftConfirmation: Encodable {
    let id: String
    let revision: Int
}

struct GeneratedMediaRow: View {
    @Environment(\.mobileTheme) private var mobileTheme
    @Environment(\.colorScheme) private var colorScheme
    let card: GeneratedMediaCard
    let canConfirm: Bool
    let submitting: Bool
    let error: String?
    let isMusicPlaying: Bool
    let onPlay: () -> Void
    let onOpen: () -> Void
    let onConfirm: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 12) {
                if card.completed {
                    Button(action: onOpen) { cardLabel }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("generated-\(card.kind.rawValue)-open-\(card.id)")
                } else {
                    cardLabel
                }
                if card.completed {
                    Button(action: onPlay) {
                        Image(systemName: isMusicPlaying ? "pause.fill" : "play.fill").frame(width: 44, height: 44)
                            .background(.tint.opacity(0.12), in: .circle)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(isMusicPlaying ? "暂停" : "播放")
                    .accessibilityIdentifier("generated-\(card.kind.rawValue)-start-\(card.id)")
                } else if card.active {
                    ProgressView().controlSize(.small).accessibilityHidden(true)
                }
            }
            if card.isDraft {
                if let summary = card.item.summary, !summary.isEmpty {
                    Text(verbatim: summary).font(.subheadline).lineLimit(3)
                        .multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                if let estimate = card.item.estimatedCreditMicro {
                    Text("预计 \(Double(estimate) / 1_000_000, format: .number.precision(.fractionLength(2))) 积分")
                        .font(.caption).foregroundStyle(.secondary)
                        .multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                } else if let estimate = card.item.estimatedCostFen {
                    Text("预计 ¥\(Double(estimate) / 100, format: .number.precision(.fractionLength(2)))")
                        .font(.caption).foregroundStyle(.secondary)
                        .multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                Button(action: onConfirm) {
                    Label(submitting ? "正在提交" : "确认生成", systemImage: "sparkles")
                        .frame(maxWidth: .infinity, minHeight: 36)
                }.buttonStyle(.borderedProminent).disabled(!canConfirm || submitting)
                if !canConfirm {
                    Text("当前视频服务不可用").font(.caption).foregroundStyle(.secondary)
                        .multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            if let error = error ?? card.item.error {
                Text(verbatim: error).font(.caption).foregroundStyle(mobileTheme.danger)
                    .multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(12)
        .frame(maxWidth: 420, alignment: .leading)
        .background(card.isDraft && canConfirm ? mobileTheme.attention : mobileTheme.card,
                    in: .rect(cornerRadius: mobileTheme.corner(18)))
        .tint(mobileTheme.action)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("generated-media-\(card.id)")
    }

    private var cardLabel: some View {
        HStack(spacing: 12) {
            Image(systemName: card.symbol).font(.title3.weight(.semibold))
                .frame(width: 44, height: 44)
                .background(.tint.opacity(0.12), in: .rect(cornerRadius: mobileTheme.corner(12)))
                .foregroundStyle(.tint).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                Text(verbatim: card.isDraft ? AppLocalization.resolve("视频草稿") : card.title)
                    .font(.subheadline.weight(.semibold)).lineLimit(2)
                    .multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
                Text(verbatim: card.cardSubtitle)
                    .font(.caption).foregroundStyle(.secondary).lineLimit(card.kind == .video ? 1 : 2)
                    .multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .contentShape(.rect)
    }
}

struct GeneratedVideoDrawer: View {
    @Environment(\.dismiss) private var dismiss
    let card: GeneratedMediaCard
    let conversationID: String
    let configuration: GatewayConfiguration
    @State private var streamURL: URL?
    @State private var export: FileShareItem?
    @State private var exporting = false
    @State private var exportFailed = false
    @State private var error: String?
    @State private var retry = 0

    var body: some View {
        MobilePreview(title: card.title, closeID: "video-player-close", onClose: { dismiss() }) {
            Button("分享媒体", systemImage: "square.and.arrow.up") { exportVideo() }
                .disabled(exporting)
        } content: {
            if let error {
                Text(verbatim: error).foregroundStyle(.secondary)
                Button("重试") { retry += 1 }
                Spacer()
            } else if let streamURL {
                PreviewVideo(url: streamURL, autoplay: true) {
                    error = AppLocalization.resolve("无法播放视频")
                }
                .accessibilityIdentifier("generated-video-player-\(card.id)")
            } else {
                ProgressView("正在加载媒体").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .accessibilityIdentifier("video-player-drawer")
        .task(id: retry) { await load() }
        .sheet(item: $export) { item in
            FileShareSheet(url: item.url).onDisappear {
                try? FileManager.default.removeItem(at: item.url.deletingLastPathComponent())
            }
        }
        .alert("无法导出视频", isPresented: $exportFailed) { Button("关闭", role: .cancel) {} }
    }

    private func load() async {
        error = nil
        streamURL = nil
        do {
            let url = try await GatewayClient(configuration: configuration).mediaPlaybackURL(path: card.artifactPath(conversationID))
            try Task.checkCancellation()
            streamURL = url
            try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)
        } catch {
            if !Task.isCancelled {
                self.error = error.localizedDescription
            }
        }
    }

    private func exportVideo() {
        exporting = true
        Task {
            defer { exporting = false }
            do {
                let url = try await GatewayClient(configuration: configuration).downloadGeneratedMedia(card, conversationID: conversationID)
                export = FileShareItem(url: url)
            } catch {
                exportFailed = true
            }
        }
    }
}

private func formatGeneratedMediaTime(_ value: Double) -> String {
    let seconds = Int(max(0, value))
    return String(format: "%d:%02d", seconds / 60, seconds % 60)
}

extension GatewayClient {
    func mediaPlaybackURL(path: String) async throws -> URL {
        struct Input: Encodable { let path: String }
        struct Ticket: Decodable { let path: String }
        let ticket: Ticket = try await request(path: "/api/media/playback-ticket", method: "POST",
                                               body: encoder.encode(Input(path: path)))
        let prefix = path + "?playbackTicket="
        guard ticket.path.hasPrefix(prefix) else { throw GatewayClientError.invalidResponse }
        let value = String(ticket.path.dropFirst(prefix.count))
        guard value.range(of: "^[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil else {
            throw GatewayClientError.invalidResponse
        }
        return try makeURL(path: path, queryItems: [URLQueryItem(name: "playbackTicket", value: value)])
    }

    func downloadGeneratedMedia(_ card: GeneratedMediaCard, conversationID: String) async throws -> URL {
        try await downloadGeneratedMedia(path: card.artifactPath(conversationID),
                                         fileName: card.kind == .music ? "music.mp3" : "video.mp4")
    }

    func downloadGeneratedMedia(path: String, fileName: String) async throws -> URL {
        var request = try URLRequest(url: makeURL(path: path, queryItems: []))
        request.setValue("Bearer \(configuration.token)", forHTTPHeaderField: "Authorization")
        let (temporaryURL, response) = try await session.download(for: GatewayPairingService.shared.signedRequest(request))
        defer { try? FileManager.default.removeItem(at: temporaryURL) }
        guard let http = response as? HTTPURLResponse else { throw GatewayClientError.invalidResponse }
        guard (200 ..< 300).contains(http.statusCode) else {
            throw GatewayClientError.http(statusCode: http.statusCode, message: nil)
        }
        try Task.checkCancellation()
        let directory = FileManager.default.temporaryDirectory.appending(path: "xopc-generation-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let destination = directory.appending(path: fileName)
        do { try FileManager.default.moveItem(at: temporaryURL, to: destination) }
        catch { try? FileManager.default.removeItem(at: directory); throw error }
        return destination
    }
}
