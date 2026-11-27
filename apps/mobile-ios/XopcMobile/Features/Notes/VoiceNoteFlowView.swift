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
    @Environment(\.mobileTheme) private var mobileTheme
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
                VStack(spacing: 20) {
                    captureStageContent
                    captureNotices
                }
                .padding(20)
                .frame(maxWidth: .infinity)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(mobileTheme.canvas)
            .safeAreaInset(edge: .bottom, spacing: 0) {
                if draft == nil, unsavedAudio == nil, recorder.isRecording {
                    VoiceRecordingDock(
                        isPaused: recorder.isPaused,
                        isSaving: isSaving,
                        onTogglePause: { recorder.togglePause() },
                        onSave: { Task { await save() } }
                    )
                }
            }
            .navigationTitle(draft == nil ? LocalizedStringKey("语音笔记") : "待恢复录音")
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
        .mobileSheetPreset(.large)
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

    @ViewBuilder
    private var captureStageContent: some View {
        if let draft {
            VoiceNoteRecoveryCard(
                draft: draft,
                isSaving: isSaving,
                onDiscard: { showingDiscardConfirmation = true },
                onSave: { Task { await save() } }
            )
        } else if unsavedAudio != nil {
            VStack(spacing: 14) {
                Image(systemName: "waveform.circle")
                    .font(.largeTitle)
                    .foregroundStyle(mobileTheme.danger)
                    .accessibilityHidden(true)
                Text("录音尚未写入本地存储，请重试")
                    .foregroundStyle(mobileTheme.secondary)
                    .multilineTextAlignment(.center)
                Button("重试保存", systemImage: "arrow.clockwise") { Task { await save() } }
                    .buttonStyle(.borderedProminent)
                    .clipShape(.capsule)
                    .disabled(isSaving)
            }
            .padding(24)
            .frame(maxWidth: .infinity)
            .background(mobileTheme.panel, in: .rect(cornerRadius: mobileTheme.corner(MobileDesignTokens.radiusLg)))
        } else if recorder.isRecording {
            VoiceRecordingLiveStage(
                duration: recorder.duration,
                statusText: recorder.statusText,
                isPaused: recorder.isPaused
            )
        } else if isLoadingDraft {
            ProgressView("正在检查未完成的录音…")
                .padding(.vertical, 48)
        } else if draftLoadFailed {
            VStack(spacing: 12) {
                Text("无法读取此前保存的录音，请保留应用数据。")
                    .foregroundStyle(mobileTheme.secondary)
                    .multilineTextAlignment(.center)
                Button("重新检查", systemImage: "arrow.clockwise") { Task { await restoreDraft() } }
                    .buttonStyle(.bordered)
                    .clipShape(.capsule)
            }
            .padding(24)
            .frame(maxWidth: .infinity)
            .background(mobileTheme.panel, in: .rect(cornerRadius: mobileTheme.corner(MobileDesignTokens.radiusLg)))
        } else {
            VoiceRecordingIdleStage(statusText: recorder.statusText) {
                Task { await prepareRecording() }
            }
        }
    }

    @ViewBuilder
    private var captureNotices: some View {
        if recorder.hasRecoverableInterruption {
            Text("录音被系统中断，已自动暂停。可以继续录音或保存当前内容。")
                .font(.footnote)
                .foregroundStyle(mobileTheme.warningForeground)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .padding(12)
                .frame(maxWidth: .infinity)
                .background(mobileTheme.warningFill, in: .rect(cornerRadius: mobileTheme.corner(12)))
        }
        if recorder.isMicrophonePermissionDenied {
            Text("未获得麦克风权限，请在系统设置中允许访问。")
                .font(.footnote)
                .foregroundStyle(mobileTheme.danger)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            MicrophonePermissionSettingsButton()
        } else if let message = recorder.errorMessage ?? saveError {
            Text(message)
                .font(.footnote)
                .foregroundStyle(mobileTheme.danger)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var consentBinding: Binding<Bool> {
        Binding(get: { pendingConsentVersion != nil }, set: {
            if !$0 {
                pendingConsentVersion = nil
            }
        })
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

private struct VoiceRecordingLiveStage: View {
    @Environment(\.mobileTheme) private var mobileTheme
    let duration: Double
    let statusText: LocalizedStringResource
    let isPaused: Bool

    var body: some View {
        VStack(spacing: 14) {
            HStack(spacing: 6) {
                Circle()
                    .fill(isPaused ? mobileTheme.secondary : mobileTheme.danger)
                    .frame(width: 8, height: 8)
                Text(statusText)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(isPaused ? mobileTheme.secondary : mobileTheme.danger)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(isPaused ? mobileTheme.input : mobileTheme.dangerSoft, in: .capsule)

            (Text(duration, format: .number.precision(.fractionLength(1))) + Text(" 秒"))
                .font(.largeTitle.weight(.medium).monospacedDigit())
                .foregroundStyle(mobileTheme.foreground)
        }
        .padding(.vertical, 32)
        .padding(.horizontal, 20)
        .frame(maxWidth: .infinity)
        .background(mobileTheme.panel, in: .rect(cornerRadius: mobileTheme.corner(MobileDesignTokens.radiusLg)))
    }
}

private struct VoiceRecordingIdleStage: View {
    @Environment(\.mobileTheme) private var mobileTheme
    let statusText: LocalizedStringResource
    let onStart: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "mic.fill")
                .font(.title)
                .foregroundStyle(mobileTheme.action)
                .frame(width: 64, height: 64)
                .background(mobileTheme.active, in: .circle)
                .accessibilityHidden(true)
            Text(statusText)
                .foregroundStyle(mobileTheme.secondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            Button(action: onStart) {
                Label {
                    Text("开始录音")
                        .font(.subheadline.weight(.semibold))
                        .lineLimit(nil)
                        .fixedSize(horizontal: false, vertical: true)
                } icon: {
                    Image(systemName: "mic.fill")
                }
                .foregroundStyle(mobileTheme.onAction)
                .frame(maxWidth: .infinity, minHeight: 48)
                .background(mobileTheme.action, in: .capsule)
            }
            .buttonStyle(.plain)
        }
        .padding(24)
        .frame(maxWidth: .infinity)
        .background(mobileTheme.panel, in: .rect(cornerRadius: mobileTheme.corner(MobileDesignTokens.radiusLg)))
    }
}

private struct VoiceRecordingDock: View {
    @Environment(\.mobileTheme) private var mobileTheme
    let isPaused: Bool
    let isSaving: Bool
    let onTogglePause: () -> Void
    let onSave: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Button(action: onTogglePause) {
                Label {
                    Text(isPaused ? LocalizedStringResource("继续") : LocalizedStringResource("暂停"))
                } icon: {
                    Image(systemName: isPaused ? "play.fill" : "pause.fill")
                }
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(mobileTheme.foreground)
                .frame(maxWidth: .infinity, minHeight: 48)
                .background(mobileTheme.panel, in: .capsule)
            }
            .buttonStyle(.plain)
            Button(action: onSave) {
                Label("保存", systemImage: "checkmark")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(mobileTheme.onAction)
                    .frame(maxWidth: .infinity, minHeight: 48)
                    .background(mobileTheme.danger, in: .capsule)
            }
            .buttonStyle(.plain)
            .disabled(isSaving)
            .opacity(isSaving ? MobileDesignTokens.disabledOpacity : 1)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
        .background(mobileTheme.canvas)
    }
}

private struct VoiceNoteRecoveryCard: View {
    @Environment(\.mobileTheme) private var mobileTheme
    let draft: PendingVoiceNote
    let isSaving: Bool
    let onDiscard: () -> Void
    let onSave: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "waveform")
                    .foregroundStyle(.tint)
                    .frame(width: 36, height: 36)
                    .background(Color.accentColor.opacity(0.14), in: .rect(cornerRadius: 10))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 3) {
                    Text(draft.recordedAt.millisecondsDate, format: .dateTime.year().month().day().hour().minute())
                        .mobileTextStyle(.rowTitle)
                    Text(voiceNoteTime(draft.duration))
                        .mobileTextStyle(.secondary)
                        .monospacedDigit()
                }
                Spacer(minLength: 8)
                Menu("更多", systemImage: "ellipsis.circle") {
                    Button("丢弃这段录音", systemImage: "trash", role: .destructive, action: onDiscard)
                }
                .labelStyle(.iconOnly)
                .frame(width: 44, height: 44)
                .disabled(isSaving)
            }
            Text(draft.noteID == nil
                ? LocalizedStringKey("录音已保存在此设备，等待上传")
                : LocalizedStringKey("录音仍保存在此设备，等待服务器确认保存"))
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            Button(action: onSave) {
                Label(draft.noteID == nil ? LocalizedStringKey("继续保存") : "继续处理", systemImage: "arrow.clockwise")
                    .mobileTextStyle(.rowTitle)
                    .foregroundStyle(mobileTheme.onAction)
                    .padding(.horizontal, 16)
                    .frame(minHeight: 44)
                    .background(mobileTheme.action, in: .rect(cornerRadius: 12))
            }
            .buttonStyle(.plain)
            .opacity(isSaving ? 0.5 : 1)
            .disabled(isSaving)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(mobileTheme.panel, in: .rect(cornerRadius: 16))
    }
}

struct DiscussionProcessingSection: View {
    let detail: DiscussionDetail
    let isRetrying: Bool
    let retryUsesLocalAudio: Bool
    let onRetry: () -> Void

    @Environment(\.mobileTheme) private var mobileTheme
    @State private var statusExpanded = false
    @State private var transcriptExpanded = true
    @State private var visibleSegments = 20

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            processingCard
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
                            VStack(alignment: .leading, spacing: 6) {
                                HStack(spacing: 8) {
                                    if let startedAtMs = segment.startedAtMs {
                                        Text(Self.captureTime(startedAtMs))
                                            .font(.caption.weight(.medium).monospacedDigit())
                                            .foregroundStyle(mobileTheme.action)
                                            .padding(.horizontal, 8)
                                            .padding(.vertical, 3)
                                            .background(mobileTheme.active, in: .capsule)
                                    }
                                    if let speaker = segment.speakerLabel?.trimmingCharacters(in: .whitespacesAndNewlines), !speaker.isEmpty {
                                        Text(speaker)
                                            .font(.caption.weight(.medium))
                                            .foregroundStyle(mobileTheme.secondary)
                                    }
                                }
                                Text(segment.displayText?.nonEmptyTranscript ?? segment.rawText?.nonEmptyTranscript
                                    ?? AppLocalization.string("等待转写…", locale: AppLocalization.selectedLocale))
                                    .foregroundStyle(mobileTheme.foreground)
                                    .textSelection(.enabled)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(14)
                            .background(mobileTheme.panel, in: .rect(cornerRadius: mobileTheme.corner(MobileDesignTokens.radiusMd)))
                        }
                        if detail.transcript.segments.count > visibleSegments {
                            Button("加载更多") { visibleSegments += 20 }
                                .font(.subheadline.weight(.medium))
                                .foregroundStyle(mobileTheme.action)
                        }
                    } else if !detail.transcript.text.isEmpty {
                        Text(detail.transcript.text).textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(16)
                            .background(mobileTheme.panel, in: .rect(cornerRadius: mobileTheme.corner(MobileDesignTokens.radiusMd)))
                    } else {
                        Text(transcriptPlaceholder)
                            .foregroundStyle(mobileTheme.secondary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(14)
                            .background(mobileTheme.panel, in: .rect(cornerRadius: mobileTheme.corner(MobileDesignTokens.radiusMd)))
                    }
                }
            } else if detail.discussion.status == "completed", detail.organization?.organization == nil {
                Text("没有识别到可用的语音内容")
                    .foregroundStyle(mobileTheme.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private var processingCard: some View {
        if detail.discussion.status == "completed" {
            HStack(spacing: 6) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.footnote)
                    .foregroundStyle(mobileTheme.success)
                    .accessibilityHidden(true)
                Text(detail.statusTitle)
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(mobileTheme.secondary)
            }
            .padding(.horizontal, 4)
        } else {
            VStack(alignment: .leading, spacing: 6) {
                if detail.discussion.status == "cancelled" {
                    statusHeading.frame(minHeight: 40, alignment: .leading)
                } else {
                    DisclosureGroup(isExpanded: $statusExpanded) {
                        Text(detail.statusDetail)
                            .mobileTextStyle(.secondary)
                            .foregroundStyle(mobileTheme.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    } label: {
                        statusHeading.frame(minHeight: 40, alignment: .leading)
                    }
                }
                if detail.discussion.status == "needs_attention" {
                    Button(action: onRetry) {
                        Text(retryUsesLocalAudio ? LocalizedStringResource("重新上传本地录音") : "重试")
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(mobileTheme.action)
                            .padding(.horizontal, 14)
                            .frame(minHeight: 40)
                            .background(mobileTheme.active, in: .capsule)
                    }
                    .buttonStyle(.plain)
                    .disabled(isRetrying)
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(mobileTheme.panel, in: .rect(cornerRadius: mobileTheme.corner(MobileDesignTokens.radiusMd)))
        }
    }

    private var statusHeading: some View {
        HStack(spacing: 8) {
            if detail.isProcessing {
                ProgressView().controlSize(.small).accessibilityHidden(true)
            } else {
                Image(systemName: detail.discussion.status == "completed" ? "checkmark.circle" : "doc.text")
                    .foregroundStyle(.secondary)
                    .accessibilityHidden(true)
            }
            Text(detail.statusTitle)
                .mobileTextStyle(.rowTitle)
                .foregroundStyle(mobileTheme.foreground)
                .fixedSize(horizontal: false, vertical: true)
        }
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
    @Environment(\.mobileTheme) private var mobileTheme
    let organization: DiscussionOrganization

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("讨论纪要")
                .font(.headline)
                .foregroundStyle(mobileTheme.foreground)
            Text(organization.summary)
                .foregroundStyle(mobileTheme.foreground)
                .frame(maxWidth: .infinity, alignment: .leading)
                .textSelection(.enabled)
            if !organization.keyPoints.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text("关键要点")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(mobileTheme.secondary)
                    Text(verbatim: organization.keyPoints.map { "• \($0)" }.joined(separator: "\n"))
                        .foregroundStyle(mobileTheme.foreground)
                }
            }
            factSection("决定", facts: organization.decisions)
            factSection("风险", facts: organization.risks)
            factSection("待确认问题", facts: organization.openQuestions)
            let actions = organization.actionItems.filter { $0.ignored != true }
            if !actions.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text("行动项")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(mobileTheme.secondary)
                    ForEach(actions) { action in
                        Text(verbatim: "• \(action.title)")
                            .foregroundStyle(mobileTheme.foreground)
                    }
                }
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(mobileTheme.panel, in: .rect(cornerRadius: mobileTheme.corner(18)))
    }

    @ViewBuilder
    private func factSection(_ title: LocalizedStringKey, facts: [DiscussionFact]) -> some View {
        let visible = facts.filter { $0.ignored != true }
        if !visible.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(mobileTheme.secondary)
                ForEach(visible) { fact in
                    Text(verbatim: "• \(fact.text)")
                        .foregroundStyle(mobileTheme.foreground)
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
        case "needs_attention":
            switch discussion.failureStage {
            case "audio_upload": "录音上传需要重试"
            case "organization": "笔记整理未完成"
            default: "转写需要重试"
            }
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
