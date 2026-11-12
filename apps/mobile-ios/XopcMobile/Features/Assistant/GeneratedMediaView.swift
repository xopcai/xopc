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
        item.title ?? item.summary ?? AppLocalization.resolve(isDraft ? "视频草稿" : "视频")
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

    var metadata: String {
        if kind == .music {
            let version = item.versionNumber.map { AppLocalization.resolve("第 \($0) 版") }
            let length = item.durationMs.map { formatGeneratedMediaTime(Double($0) / 1000) }
            return [version, length].compactMap(\.self).joined(separator: " · ")
        }
        let length = item.duration.map { $0 > 0 ? AppLocalization.resolve("\($0) 秒") : AppLocalization.resolve("自动时长") }
        return [length, item.resolution, item.ratio == "adaptive" ? nil : item.ratio].compactMap(\.self).joined(separator: " · ")
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
    private var scope: String?
    private var videoRequest = 0

    func observe(_ id: String?, client: GatewayClient, busy: Bool) async {
        if id != scope {
            scope = id
            cards = []
            error = nil
            canConfirm = false
            submitting = false
            videoRequest += 1
        }
        guard let id else { return }
        while !Task.isCancelled {
            await refresh(id, client: client)
            try? await Task.sleep(for: .seconds(busy || cards.contains(where: \.active) ? 3 : 20))
        }
    }

    private func refresh(_ id: String, client: GatewayClient) async {
        let request = videoRequest
        async let music = fetch(.music, id: id, client: client)
        async let video = fetch(.video, id: id, client: client)
        let (musicResult, videoResult) = await (music, video)
        guard !Task.isCancelled, scope == id else { return }
        if let musicResult {
            replace(.music, with: musicResult.jobs)
        }
        if let videoResult, request == videoRequest, !submitting {
            applyVideo(videoResult)
        }
    }

    private func fetch(_ kind: GeneratedMediaCard.Kind, id: String, client: GatewayClient) async -> GeneratedMediaResponse? {
        try? await client.request(path: "/api/\(kind.rawValue)-generation/sessions/\(id)/jobs")
    }

    private func applyVideo(_ response: GeneratedMediaResponse) {
        canConfirm = response.configured && response.draft?.modelRef == response.modelRef
        let jobs = response.jobs.filter { $0.transcriptId == response.transcriptId }
        replace(.video, with: jobs + (response.draft.map { [$0] } ?? []))
    }

    private func replace(_ kind: GeneratedMediaCard.Kind, with items: [GeneratedMediaPayload]) {
        let next = (cards.filter { $0.kind != kind } + items.map { GeneratedMediaCard(kind: kind, item: $0) })
            .sorted { ($0.order, $0.id) < ($1.order, $1.id) }
        if next != cards {
            cards = next
        }
    }

    func confirm(_ card: GeneratedMediaCard, conversationID: String, client: GatewayClient) async {
        guard !submitting, scope == conversationID, card.isDraft, canConfirm, let revision = card.item.revision else { return }
        submitting = true
        error = nil
        videoRequest += 1
        let request = videoRequest
        defer {
            if scope == conversationID, videoRequest == request {
                submitting = false
            }
        }
        do {
            let job: GeneratedMediaPayload = try await client.request(
                path: card.jobsPath(conversationID) + "/confirm-draft", method: "POST",
                body: client.encoder.encode(GeneratedDraftConfirmation(id: card.id, revision: revision))
            )
            guard scope == conversationID, videoRequest == request else { return }
            replace(.video, with: cards.filter { $0.kind == .video && $0.id != job.id && !$0.isDraft }.map(\.item) + [job])
        } catch {
            guard scope == conversationID, videoRequest == request else { return }
            self.error = error.localizedDescription
            if let response = await fetch(.video, id: conversationID, client: client),
               scope == conversationID, videoRequest == request
            {
                applyVideo(response)
            }
        }
    }

    func cardsByReply(_ messages: [TimelineMessage]) -> [String: [GeneratedMediaCard]] {
        let replies = messages.filter { $0.role == "assistant" && $0.answerConfirmed }
        var anchors: [String: String] = [:]
        for reply in replies {
            for id in reply.generatedMediaIds where anchors[id] == nil {
                anchors[id] = reply.id
            }
        }
        return Dictionary(grouping: cards) { anchors[$0.id] ?? replies.last?.id ?? "" }
    }
}

private struct GeneratedDraftConfirmation: Encodable {
    let id: String
    let revision: Int
}

struct GeneratedMediaRow: View {
    let card: GeneratedMediaCard
    let canConfirm: Bool
    let submitting: Bool
    let error: String?
    let onPlay: () -> Void
    let onConfirm: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 12) {
                Image(systemName: card.symbol).font(.title3.weight(.semibold))
                    .frame(width: 44, height: 44)
                    .background(.tint.opacity(0.12), in: .rect(cornerRadius: 12))
                    .foregroundStyle(.tint).accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 3) {
                    Text(verbatim: card.isDraft ? AppLocalization.resolve("视频草稿") : card.title)
                        .font(.subheadline.weight(.semibold)).lineLimit(2)
                    Text(verbatim: card.completed ? card.metadata : [card.status, card.metadata]
                        .filter { !$0.isEmpty }.joined(separator: " · "))
                        .font(.caption).foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
                if card.completed {
                    Button(action: onPlay) {
                        Image(systemName: "play.fill").frame(width: 44, height: 44)
                            .background(.tint.opacity(0.12), in: .circle)
                    }.buttonStyle(.plain).accessibilityLabel("播放")
                } else if card.active {
                    ProgressView().controlSize(.small).accessibilityHidden(true)
                }
            }
            if card.isDraft {
                Text(verbatim: card.item.summary ?? card.item.prompt ?? "").font(.subheadline).lineLimit(3)
                if let estimate = card.item.estimatedCostFen {
                    Text("预计 ¥\(Double(estimate) / 100, format: .number.precision(.fractionLength(2)))")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Button(action: onConfirm) {
                    Label(submitting ? "正在提交" : "确认生成", systemImage: "sparkles")
                        .frame(maxWidth: .infinity, minHeight: 36)
                }.buttonStyle(.borderedProminent).disabled(!canConfirm || submitting)
                if !canConfirm {
                    Text("当前视频服务不可用").font(.caption).foregroundStyle(.secondary)
                }
            }
            if let error = error ?? card.item.error {
                Text(verbatim: error).font(.caption).foregroundStyle(.secondary)
            }
            if let prompt = card.item.prompt, !prompt.isEmpty, !card.isDraft || card.item.summary != nil {
                DisclosureGroup("创作详情") {
                    Text(verbatim: prompt).font(.caption).foregroundStyle(.secondary)
                        .textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
                }.font(.caption).tint(.secondary)
            }
        }
        .padding(12)
        .frame(maxWidth: 420, alignment: .leading)
        .background(Color(uiColor: .secondarySystemBackground), in: .rect(cornerRadius: 18))
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityIdentifier("generated-media-\(card.id)")
    }
}

struct GeneratedMediaPlayerSheet: View {
    let card: GeneratedMediaCard
    let conversationID: String
    let configuration: GatewayConfiguration

    @Environment(\.dismiss) private var dismiss
    @State private var player: AVPlayer?
    @State private var localURL: URL?
    @State private var error: String?
    @State private var retry = 0
    @State private var showLyrics = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if let player {
                        if card.kind == .video {
                            VideoPlayer(player: player).aspectRatio(card.item.ratio == "9:16" ? 9.0 / 16 : 16.0 / 9, contentMode: .fit)
                                .clipShape(.rect(cornerRadius: 16))
                        } else {
                            musicControls(player)
                            if let lyrics = card.item.lyrics, !lyrics.isEmpty {
                                DisclosureGroup("歌词", isExpanded: $showLyrics) {
                                    Text(verbatim: lyrics).font(.body).textSelection(.enabled)
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                        .padding(.top, 8)
                                }
                            }
                        }
                    } else if let error {
                        Text(verbatim: error).foregroundStyle(.secondary)
                        Button("重试") { retry += 1 }
                    } else {
                        ProgressView("正在加载媒体").frame(maxWidth: .infinity, minHeight: 120)
                    }
                }.padding(20)
            }
            .navigationTitle(card.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("关闭") { dismiss() } }
                if let localURL {
                    ToolbarItem(placement: .primaryAction) {
                        ShareLink(item: localURL) { Image(systemName: "square.and.arrow.up").accessibilityLabel("分享媒体") }
                    }
                }
            }
            .task(id: retry) { await load() }
            .onDisappear {
                player?.pause()
                player?.replaceCurrentItem(with: nil)
                if let localURL {
                    try? FileManager.default.removeItem(at: localURL.deletingLastPathComponent())
                }
            }
        }.presentationDetents([.medium, .large]).presentationDragIndicator(.visible)
    }

    private func musicControls(_ player: AVPlayer) -> some View {
        TimelineView(.periodic(from: .now, by: 0.25)) { _ in
            let time = player.currentTime().seconds
            let position = time.isFinite ? max(0, time) : 0
            let measured = player.currentItem?.duration.seconds ?? 0
            let duration = measured.isFinite && measured > 0 ? measured : Double(card.item.durationMs ?? 0) / 1000
            VStack(spacing: 6) {
                Slider(value: Binding(get: { min(position, duration) }, set: {
                    player.seek(to: CMTime(seconds: $0, preferredTimescale: 600))
                }), in: 0 ... max(1, duration)).disabled(duration == 0).accessibilityLabel("播放进度")
                HStack {
                    Button {
                        if player.rate == 0 {
                            if duration > 0, position >= duration - 0.1 {
                                player.seek(to: .zero)
                            }
                            player.play()
                        } else {
                            player.pause()
                        }
                    } label: {
                        Image(systemName: player.rate == 0 ? "play.fill" : "pause.fill")
                            .frame(width: 44, height: 44).background(.tint.opacity(0.12), in: .circle)
                    }.buttonStyle(.plain).accessibilityLabel(player.rate == 0 ? "播放" : "暂停")
                    Spacer()
                    Text(verbatim: "\(formatGeneratedMediaTime(position)) / \(formatGeneratedMediaTime(duration))")
                        .font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                }
            }
        }
    }

    private func load() async {
        error = nil
        do {
            let url = try await GatewayClient(configuration: configuration).downloadGeneratedMedia(card, conversationID: conversationID)
            guard !Task.isCancelled else { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()); return }
            localURL = url
            try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)
            let media = AVPlayer(url: url)
            player = media
            media.play()
        } catch is CancellationError {
        } catch {
            if !Task.isCancelled {
                self.error = error.localizedDescription
            }
        }
    }
}

private func formatGeneratedMediaTime(_ value: Double) -> String {
    let seconds = Int(max(0, value))
    return String(format: "%d:%02d", seconds / 60, seconds % 60)
}

extension GatewayClient {
    func downloadGeneratedMedia(_ card: GeneratedMediaCard, conversationID: String) async throws -> URL {
        var request = try URLRequest(url: makeURL(path: card.artifactPath(conversationID), queryItems: []))
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
        let destination = directory.appending(path: card.kind == .music ? "music.mp3" : "video.mp4")
        do { try FileManager.default.moveItem(at: temporaryURL, to: destination) }
        catch { try? FileManager.default.removeItem(at: directory); throw error }
        return destination
    }
}
