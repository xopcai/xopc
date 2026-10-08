// swiftlint:disable file_length
import AVFoundation
import SwiftUI

struct VoiceNoteFlowView: View {
    let configuration: GatewayConfiguration
    let onOpenConversation: (String, String, String) -> Void

    @State private var savedNoteID: String?

    var body: some View {
        if let savedNoteID {
            NavigationStack {
                NoteDetailView(
                    configuration: configuration,
                    noteID: savedNoteID,
                    onOpenConversation: onOpenConversation,
                    showsCloseButton: true
                )
            }
        } else {
            VoiceNoteCaptureView(configuration: configuration) { savedNoteID = $0 }
        }
    }
}

private struct VoiceNoteCaptureView: View {
    let configuration: GatewayConfiguration
    let onSaved: (String) -> Void
    private let draftStore: PendingVoiceNoteStore

    @Environment(\.dismiss) private var dismiss
    @State private var recorder = VoiceRecorder()
    @State private var draft: PendingVoiceNote?
    @State private var unsavedAudio: RecordedAudio?
    @State private var isLoadingDraft = true
    @State private var draftLoadFailed = false
    @State private var isSaving = false
    @State private var saveError: String?
    @State private var pendingConsentVersion: Int?
    @State private var showingDiscardConfirmation = false
    @State private var showingUnsavedConfirmation = false

    init(configuration: GatewayConfiguration, onSaved: @escaping (String) -> Void) {
        self.configuration = configuration
        self.onSaved = onSaved
        draftStore = PendingVoiceNoteStore(gatewayURL: configuration.baseURL)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 24) {
                    Image(systemName: recorder.isRecording || draft != nil ? "waveform.circle.fill" : "mic.circle")
                        .font(.system(size: 76))
                        .foregroundStyle(recorder.isRecording ? .red : .blue)
                        .accessibilityHidden(true)
                    if let draft {
                        Text(draft.duration, format: .number.precision(.fractionLength(1))) + Text(" 秒")
                            .font(.title.monospacedDigit())
                        Text(draft.noteID == nil
                            ? LocalizedStringKey("录音已保存在此设备，等待上传")
                            : LocalizedStringKey("录音仍保存在此设备，等待服务器确认保存"))
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                            .fixedSize(horizontal: false, vertical: true)
                        Button(draft.noteID == nil ? LocalizedStringKey("继续保存") : LocalizedStringKey("继续处理"), systemImage: "arrow.clockwise") {
                            Task { await save() }
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(isSaving)
                        Button("丢弃这段录音", role: .destructive) { showingDiscardConfirmation = true }
                            .disabled(isSaving)
                    } else if unsavedAudio != nil {
                        Text("录音尚未写入本地存储，请重试")
                            .foregroundStyle(.secondary)
                        Button("重试保存", systemImage: "arrow.clockwise") { Task { await save() } }
                            .buttonStyle(.borderedProminent)
                            .disabled(isSaving)
                    } else if recorder.isRecording {
                        Text(recorder.duration, format: .number.precision(.fractionLength(1))) + Text(" 秒")
                            .font(.title.monospacedDigit())
                        recorderStatusText
                        HStack {
                            Button {
                                recorder.togglePause()
                            } label: {
                                Label {
                                    Text(recorder.isPaused
                                        ? LocalizedStringResource("继续")
                                        : LocalizedStringResource("暂停"))
                                } icon: {
                                    Image(systemName: recorder.isPaused ? "play.fill" : "pause.fill")
                                }
                            }
                            .buttonStyle(.bordered)
                            Button("保存", systemImage: "checkmark") { Task { await save() } }
                                .buttonStyle(.borderedProminent)
                                .disabled(isSaving)
                        }
                    } else if isLoadingDraft {
                        ProgressView("正在检查未完成的录音…")
                    } else if draftLoadFailed {
                        Text("无法读取此前保存的录音，请保留应用数据。")
                            .foregroundStyle(.secondary)
                        Button("重新检查", systemImage: "arrow.clockwise") { Task { await restoreDraft() } }
                    } else {
                        recorderStatusText
                        Button { Task { await prepareRecording() } } label: {
                            Label {
                                Text("开始录音")
                                    .lineLimit(nil)
                                    .fixedSize(horizontal: false, vertical: true)
                            } icon: {
                                Image(systemName: "mic.fill")
                            }
                            .frame(maxWidth: .infinity, minHeight: 48)
                        }
                        .buttonStyle(.borderedProminent)
                    }
                    if recorder.hasRecoverableInterruption {
                        Text("录音被系统中断，已自动暂停。可以继续录音或保存当前内容。")
                            .font(.footnote)
                            .foregroundStyle(.orange)
                            .multilineTextAlignment(.center)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    if recorder.isMicrophonePermissionDenied {
                        Text("未获得麦克风权限，请在系统设置中允许访问。")
                            .font(.footnote)
                            .foregroundStyle(.red)
                            .multilineTextAlignment(.center)
                            .fixedSize(horizontal: false, vertical: true)
                        MicrophonePermissionSettingsButton()
                    } else if let message = recorder.errorMessage ?? saveError {
                        Text(message)
                            .font(.footnote)
                            .foregroundStyle(.red)
                            .multilineTextAlignment(.center)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding()
                .frame(maxWidth: .infinity, minHeight: 360)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .navigationTitle("语音笔记")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button {
                        if unsavedAudio != nil || recorder.isRecording {
                            showingUnsavedConfirmation = true
                        } else {
                            recorder.cancel()
                            dismiss()
                        }
                    } label: {
                        Text(draft == nil ? LocalizedStringResource("取消") : LocalizedStringResource("关闭"))
                    }
                }
            }
            .overlay {
                if isSaving {
                    ProgressView("正在保存…").padding().background(.regularMaterial, in: .rect(cornerRadius: 14))
                }
            }
        }
        .presentationDetents(voiceNoteDetents)
        .interactiveDismissDisabled(recorder.isRecording || unsavedAudio != nil)
        .task { await restoreDraft() }
        .onReceive(NotificationCenter.default.publisher(for: AVAudioSession.interruptionNotification)) {
            recorder.handleAudioInterruption($0)
        }
        .alert("录音与转写", isPresented: consentBinding) {
            Button("同意并开始") { Task { await acknowledgeAndStart() } }
            Button("取消", role: .cancel) { pendingConsentVersion = nil }
        } message: {
            Text("开始前请确认已获得在场人员同意。录音将上传到 Gateway，用于生成转写和笔记。")
        }
        .confirmationDialog("丢弃本地录音？", isPresented: $showingDiscardConfirmation) {
            Button("丢弃录音", role: .destructive) { Task { await discardDraft() } }
        } message: {
            Text("丢弃后这段尚未上传的录音无法恢复。")
        }
        .confirmationDialog("录音尚未保存", isPresented: $showingUnsavedConfirmation) {
            Button("丢弃录音", role: .destructive) {
                recorder.cancel()
                unsavedAudio = nil
                dismiss()
            }
        } message: {
            Text("请先重试保存。现在关闭将丢失这段录音。")
        }
    }

    private var consentBinding: Binding<Bool> {
        Binding(get: { pendingConsentVersion != nil }, set: {
            if !$0 {
                pendingConsentVersion = nil
            }
        })
    }

    private var voiceNoteDetents: Set<PresentationDetent> {
        [.large]
    }

    private var recorderStatusText: some View {
        Text(recorder.statusText)
            .foregroundStyle(.secondary)
            .multilineTextAlignment(.center)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.vertical, 12)
    }

    @MainActor private func prepareRecording() async {
        guard draft == nil, unsavedAudio == nil, !isLoadingDraft, !draftLoadFailed else { return }
        do {
            let settings = try await GatewayClient(configuration: configuration).fetchDiscussionCaptureSettings()
            if settings.consentAcknowledgedAt == nil {
                pendingConsentVersion = settings.consentPolicyVersion
            } else {
                await recorder.start()
            }
        } catch { saveError = error.localizedDescription }
    }

    @MainActor private func acknowledgeAndStart() async {
        guard let version = pendingConsentVersion else { return }
        pendingConsentVersion = nil
        do {
            try await GatewayClient(configuration: configuration).acknowledgeDiscussionConsent(version: version)
            await recorder.start()
        } catch { saveError = error.localizedDescription }
    }

    @MainActor private func restoreDraft() async {
        isLoadingDraft = true
        defer { isLoadingDraft = false }
        do {
            draft = try await draftStore.load()
            draftLoadFailed = false
            saveError = nil
        } catch {
            draftLoadFailed = true
            saveError = error.localizedDescription
        }
    }

    @MainActor private func save() async {
        guard !isSaving else { return }
        isSaving = true
        defer { isSaving = false }
        saveError = nil
        do {
            if draft == nil {
                if unsavedAudio == nil {
                    unsavedAudio = recorder.finishRecording(retainSource: true)
                }
                guard let unsavedAudio else { return }
                draft = try await draftStore.save(unsavedAudio)
                self.unsavedAudio = nil
                recorder.cancel()
            }
            guard let draft else { return }
            let noteID = try await VoiceNoteSubmission(
                store: draftStore,
                gateway: GatewayClient(configuration: configuration)
            ).resume(draft)
            onSaved(noteID)
        } catch {
            draft = await (try? draftStore.load()) ?? draft
            saveError = FileUploadFailureMessage.resolve(error)
        }
    }

    @MainActor private func discardDraft() async {
        do {
            try await draftStore.clear()
            draft = nil
            unsavedAudio = nil
            saveError = nil
        } catch { saveError = error.localizedDescription }
    }
}

struct DiscussionProcessingSection: View {
    let detail: DiscussionDetail
    let isRetrying: Bool
    let retryUsesLocalAudio: Bool
    let onRetry: () -> Void

    @State private var transcriptExpanded = true
    @State private var visibleSegments = 20

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("语音记录", systemImage: "waveform")
                .font(.headline)
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 10) {
                    if detail.isProcessing {
                        ProgressView().controlSize(.small)
                    } else {
                        Image(systemName: detail.discussion.status == "needs_attention" ? "exclamationmark.triangle.fill" : "checkmark.circle.fill")
                            .foregroundStyle(detail.discussion.status == "needs_attention" ? .orange : .green)
                    }
                    Text(detail.statusTitle)
                        .font(.headline)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Text(detail.statusDetail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if detail.discussion.status == "needs_attention" {
                    Button(action: onRetry) {
                        Text(retryUsesLocalAudio
                            ? LocalizedStringResource("重新上传本地录音")
                            : LocalizedStringResource("重试"))
                            .fixedSize(horizontal: false, vertical: true)
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .buttonStyle(.bordered)
                    .disabled(isRetrying)
                }
            }
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.blue.opacity(0.09), in: .rect(cornerRadius: 14))
            if let organization = detail.organization?.organization {
                DiscussionSummarySection(organization: organization)
            }
            if showsTranscriptSection {
                Button {
                    transcriptExpanded.toggle()
                } label: {
                    HStack {
                        Text("逐字稿").font(.headline)
                        Spacer()
                        Image(systemName: transcriptExpanded ? "chevron.up" : "chevron.down")
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("逐字稿")
                .padding(.top, 4)
                if transcriptExpanded {
                    if !detail.transcript.segments.isEmpty {
                        ForEach(detail.transcript.segments.prefix(visibleSegments)) { segment in
                            VStack(alignment: .leading, spacing: 5) {
                                HStack(spacing: 8) {
                                    if let startedAtMs = segment.startedAtMs {
                                        Text(Self.captureTime(startedAtMs))
                                            .foregroundStyle(.blue)
                                    }
                                    if let speaker = segment.speakerLabel?.trimmingCharacters(in: .whitespacesAndNewlines), !speaker.isEmpty {
                                        Text(speaker).foregroundStyle(.secondary)
                                    }
                                }
                                .font(.caption)
                                Text(segment.displayText?.nonEmptyTranscript ?? segment.rawText?.nonEmptyTranscript
                                    ?? AppLocalization.string("等待转写…", locale: AppLocalization.selectedLocale))
                                    .textSelection(.enabled)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(12)
                            .background(Color.secondary.opacity(0.08), in: .rect(cornerRadius: 12))
                        }
                        if detail.transcript.segments.count > visibleSegments {
                            Button("加载更多") { visibleSegments += 20 }
                        }
                    } else if !detail.transcript.text.isEmpty {
                        Text(detail.transcript.text).textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(12)
                            .background(Color.secondary.opacity(0.08), in: .rect(cornerRadius: 12))
                    } else {
                        Text(transcriptPlaceholder)
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(12)
                            .background(Color.secondary.opacity(0.08), in: .rect(cornerRadius: 12))
                    }
                }
            } else if detail.discussion.status == "completed", detail.organization?.organization == nil {
                Text("没有识别到可用的语音内容")
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var showsTranscriptSection: Bool {
        !detail.transcript.segments.isEmpty
            || !detail.transcript.text.isEmpty
            || detail.isProcessing
            || detail.discussion.status == "needs_attention"
    }

    private var transcriptPlaceholder: LocalizedStringResource {
        detail.discussion.status == "needs_attention"
            ? "转写暂不可用，重试后可继续生成。"
            : "等待转写…"
    }

    private static func captureTime(_ milliseconds: Int64) -> String {
        let seconds = max(0, milliseconds / 1000)
        return String(format: "%02lld:%02lld", seconds / 60, seconds % 60)
    }
}

private struct DiscussionSummarySection: View {
    let organization: DiscussionOrganization

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("讨论纪要").font(.headline)
            Text(organization.summary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .textSelection(.enabled)
            if !organization.keyPoints.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text("关键要点").font(.subheadline.weight(.semibold))
                    Text(verbatim: organization.keyPoints.map { "• \($0)" }.joined(separator: "\n"))
                }
            }
            factSection("决定", facts: organization.decisions)
            factSection("风险", facts: organization.risks)
            factSection("待确认问题", facts: organization.openQuestions)
            let actions = organization.actionItems.filter { $0.ignored != true }
            if !actions.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text("行动项").font(.subheadline.weight(.semibold))
                    ForEach(actions) { action in
                        Text(verbatim: "• \(action.title)")
                    }
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(uiColor: .systemGray5), in: .rect(cornerRadius: 16))
    }

    @ViewBuilder
    private func factSection(_ title: LocalizedStringKey, facts: [DiscussionFact]) -> some View {
        let visible = facts.filter { $0.ignored != true }
        if !visible.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                Text(title).font(.subheadline.weight(.semibold))
                ForEach(visible) { fact in
                    Text(verbatim: "• \(fact.text)")
                }
            }
        }
    }
}

extension DiscussionDetail {
    var isProcessing: Bool {
        ["recording", "stopping", "sealing", "organizing"].contains(discussion.status)
            || recordingJob?.state == "queued" || recordingJob?.state == "running"
    }

    var statusTitle: LocalizedStringResource {
        switch discussion.status {
        case "recording": "正在保存录音"
        case "stopping": discussion.audioAttachmentId == nil ? "正在保存录音" : "正在生成转写"
        case "sealing": "正在生成转写"
        case "organizing": "正在整理笔记"
        case "needs_attention": discussion.failureStage == "audio_upload" ? "录音上传需要重试" : "转写需要重试"
        case "completed": "转写已完成"
        case "cancelled": "录音已取消"
        default: "正在处理语音笔记"
        }
    }

    var statusDetail: LocalizedStringResource {
        if discussion.status == "needs_attention" {
            if discussion.failureStage == "audio_upload" {
                return "录音上传失败，请重试。"
            }
            return discussion.failureStage == "transcript_sealing" ? "转写失败，录音仍已安全保存。" : "处理失败，录音仍已安全保存。"
        }
        if discussion.audioAttachmentId != nil, isProcessing {
            return "录音已保存，正在生成逐字稿和纪要；页面会自动更新。"
        }
        let stats = transcript.stats
        if stats.confirmed > 0 || stats.transcribing > 0 {
            return "已转写 \(stats.confirmed) 段，处理中 \(stats.transcribing) 段"
        }
        return "你可以留在此页面，进度会自动更新。"
    }
}

private extension String {
    var nonEmptyTranscript: String? {
        let value = trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? nil : value
    }
}
