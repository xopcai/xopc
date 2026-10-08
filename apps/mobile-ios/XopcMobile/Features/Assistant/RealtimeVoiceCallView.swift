import SwiftUI

// swiftlint:disable:next type_body_length
struct RealtimeVoiceCallView: View {
    let call: RealtimeVoiceCall

    @Environment(\.locale) private var locale
    @State private var answer = ""

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Button("缩小通话", systemImage: "chevron.down") { call.minimize() }
                    .labelStyle(.iconOnly)
                    .frame(width: 44, height: 44)
                    .background(Color(uiColor: .secondarySystemGroupedBackground), in: .circle)
                    .accessibilityIdentifier("voice-call-minimize")
                Spacer()
                Text(call.mode.title)
                    .font(.caption.weight(.medium))
                    .padding(.horizontal, 12)
                    .padding(.vertical, 7)
                    .background(Color(uiColor: .secondarySystemGroupedBackground), in: .capsule)
            }

            Spacer(minLength: 24)
            Image(systemName: "waveform")
                .font(.system(size: 62, weight: .light))
                .foregroundStyle(.blue)
                .frame(width: 172, height: 172)
                .background(Color.blue.opacity(0.08), in: .circle)
                .accessibilityHidden(true)
            Text(call.name.isEmpty ? AppLocalization.string("语音通话", locale: locale) : call.name)
                .font(.title2.bold())
                .lineLimit(2)
                .multilineTextAlignment(.center)
                .padding(.top, 20)
            Text(AppLocalization.string(status, locale: locale))
                .font(.subheadline)
                .foregroundStyle(call.errorCode == nil ? Color.secondary : Color.red)
                .padding(.top, 8)
                .accessibilityIdentifier("voice-call-status")
            if call.phase == .connected, call.networkQuality != "good" {
                Label(call.networkQuality == "critical" ? "网络较差，正在缓冲" : "网络波动",
                      systemImage: "wifi.exclamationmark")
                    .font(.caption)
                    .foregroundStyle(.orange)
                    .padding(.top, 5)
            }
            if call.phase == .connected, call.route != "system" {
                Text(routeTitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.top, 4)
            }
            if !call.activity.isEmpty {
                Text(call.activity).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            TimelineView(.periodic(from: call.startedAt, by: 1)) { context in
                Text(elapsed(context.date))
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
            if let errorCode = call.errorCode {
                Text(errorMessage(for: errorCode))
                    .font(.caption)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
                    .padding(.top, 6)
                    .accessibilityIdentifier("voice-call-error")
            }

            if let clarification = call.clarification {
                clarificationCard(clarification)
                    .padding(.top, 24)
            } else if let approval = call.approval {
                approvalCard(approval)
                    .padding(.top, 24)
            } else if !call.assistantText.isEmpty || !call.userText.isEmpty {
                Text(call.assistantText.isEmpty ? call.userText : call.assistantText)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(4)
                    .multilineTextAlignment(.center)
                    .padding(.top, 24)
                    .accessibilityIdentifier("voice-call-transcript")
            }

            Spacer(minLength: 24)
            if !call.responseID.isEmpty || !call.taskID.isEmpty {
                Button {
                    Task {
                        if call.taskID.isEmpty {
                            await call.stopReply()
                        } else {
                            await call.cancelTask()
                        }
                    }
                } label: {
                    Text(call.taskID.isEmpty ? LocalizedStringResource("停止回复") : LocalizedStringResource("取消任务"))
                }
                .buttonStyle(.bordered)
                .padding(.bottom, 24)
                .disabled(call.taskCancelling)
            }
            HStack(spacing: 12) {
                control("静音", image: call.muted ? "mic.slash.fill" : "mic", active: call.muted) {
                    Task { await call.setMuted(!call.muted) }
                }
                control("扬声器", image: "speaker.wave.2", active: call.speaker) {
                    call.setSpeaker(!call.speaker)
                }
                if call.phase == .paused {
                    control("重试", image: "arrow.clockwise", active: false) {
                        Task { await call.resume() }
                    }
                }
                control("结束", image: "phone.down.fill", active: true, destructive: true) {
                    Task { await call.end() }
                }
                .accessibilityIdentifier("voice-call-end")
            }
        }
        .frame(maxWidth: 520)
        .padding(.horizontal, 18)
        .padding(.top, 18)
        .padding(.bottom, 30)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(uiColor: .systemGroupedBackground))
    }

    private var status: String {
        if call.phase == .connecting {
            return "正在连接"
        }
        if call.phase == .recovering {
            return "正在重新连接"
        }
        if call.phase == .paused {
            return "通话已暂停"
        }
        if call.phase == .ending {
            return "正在结束"
        }
        if call.muted {
            return "已静音"
        }
        if call.responseStage == "speaking" {
            return "正在说话"
        }
        if !call.activity.isEmpty {
            return "正在执行任务"
        }
        if !call.responseID.isEmpty {
            return "正在思考"
        }
        return "正在聆听"
    }

    private var routeTitle: LocalizedStringResource {
        switch call.route {
        case "speaker": "扬声器"
        case "earpiece": "听筒"
        case "bluetooth": "蓝牙"
        case "headset": "耳机"
        default: "系统音频"
        }
    }

    private func elapsed(_ date: Date) -> String {
        let seconds = max(0, Int(date.timeIntervalSince(call.startedAt)))
        return "\(seconds / 60):\(String(format: "%02d", seconds % 60))"
    }

    private func errorMessage(for code: String) -> String {
        let key: String = switch code {
        case "OMNI_CONNECTION_CLOSED", "PROVIDER_UNAVAILABLE", "SERVICE_UNAVAILABLE":
            "语音服务暂时不可用，请稍后重试"
        case "NETWORK", "AUDIO_INTERRUPTED":
            "通话已中断，请重试"
        case "TIME_LIMIT":
            "本次通话已达到时长上限"
        case "ROUTE_CHANGE_FAILED", "PLAYBACK_FAILED", "UNSUPPORTED_FORMAT", "AUDIO_UNAVAILABLE":
            "音频设备暂时不可用，请重试"
        case "MICROPHONE_PERMISSION_DENIED":
            "请在系统设置中允许使用麦克风"
        default:
            code.range(of: "^[A-Z][A-Z0-9_]+$", options: .regularExpression) == nil
                ? code : "语音通话失败，请重试"
        }
        return AppLocalization.string(key, locale: locale)
    }

    private func control(
        _ title: LocalizedStringResource,
        image: String,
        active: Bool,
        destructive: Bool = false,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            VStack(spacing: 7) {
                Image(systemName: image)
                    .font(.title3)
                    .frame(width: 56, height: 56)
                    .background(
                        destructive ? Color.red : active ? Color.blue.opacity(0.13) : Color(uiColor: .secondarySystemGroupedBackground),
                        in: .circle
                    )
                    .foregroundStyle(destructive ? Color.white : active ? Color.blue : Color.primary)
                Text(title).font(.caption).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(title))
    }

    private func clarificationCard(_ clarification: RealtimeVoiceCall.Clarification) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(clarification.question).font(.subheadline.weight(.medium))
            if !clarification.choices.isEmpty {
                ScrollView(.horizontal) {
                    HStack {
                        ForEach(clarification.choices, id: \.self) { choice in
                            Button(choice) { Task { await call.submitClarification(action: "answer", answer: choice) } }
                                .buttonStyle(.bordered)
                                .disabled(call.respondingToIntervention)
                        }
                    }
                }
            }
            TextField(
                clarification.suggestedAnswer.isEmpty
                    ? AppLocalization.string("输入回答", locale: locale)
                    : clarification.suggestedAnswer,
                text: $answer
            )
            .textFieldStyle(.roundedBorder)
            HStack {
                Button("交给助手决定") { Task { await call.submitClarification(action: "agent_decide") } }
                    .buttonStyle(.bordered)
                    .disabled(call.respondingToIntervention)
                Spacer()
                Button("发送") {
                    let text = answer.trimmingCharacters(in: .whitespacesAndNewlines)
                    guard !text.isEmpty else { return }
                    Task { await call.submitClarification(action: "answer", answer: text) }
                    answer = ""
                }
                .buttonStyle(.borderedProminent)
                .disabled(call.respondingToIntervention || answer.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(14)
        .background(Color(uiColor: .secondarySystemGroupedBackground), in: .rect(cornerRadius: 18))
    }

    private func approvalCard(_ approval: RealtimeVoiceApproval) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("连接器操作需要确认")
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(approval.actionId)
                .font(.subheadline.weight(.medium))
            HStack {
                Button("拒绝") { Task { await call.respondToApproval(approved: false) } }
                    .buttonStyle(.bordered)
                    .disabled(call.respondingToIntervention)
                Spacer()
                Button("批准") { Task { await call.respondToApproval(approved: true) } }
                    .buttonStyle(.borderedProminent)
                    .disabled(call.respondingToIntervention)
            }
        }
        .padding(14)
        .background(Color(uiColor: .secondarySystemGroupedBackground), in: .rect(cornerRadius: 18))
    }
}

struct RealtimeVoiceMiniBar: View {
    let call: RealtimeVoiceCall

    @Environment(\.locale) private var locale

    var body: some View {
        HStack(spacing: 12) {
            Button { call.expand() } label: {
                HStack(spacing: 12) {
                    Image(systemName: "waveform").foregroundStyle(.blue)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(call.name.isEmpty ? AppLocalization.string("语音通话", locale: locale) : call.name)
                            .font(.subheadline.weight(.medium))
                            .lineLimit(1)
                        Text(AppLocalization.string(
                            call.phase == .paused ? "通话已暂停 · 点击重试"
                                : call.phase == .recovering ? "正在重新连接"
                                : call.phase == .connecting ? "正在连接" : "通话进行中",
                            locale: locale
                        ))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    }
                    Spacer()
                }
            }
            .buttonStyle(.plain)
            .accessibilityLabel("返回语音通话")
            Button("结束通话", systemImage: "phone.down.fill") { Task { await call.end() } }
                .labelStyle(.iconOnly)
                .foregroundStyle(.white)
                .frame(width: 38, height: 38)
                .background(.red, in: .circle)
        }
        .padding(.horizontal, 14)
        .frame(height: 62)
        .background(.regularMaterial, in: .rect(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(.secondary.opacity(0.15)))
        .padding(.horizontal, 16)
    }
}
