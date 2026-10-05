import AVFoundation
import Observation
import SwiftUI
import UIKit

struct VoiceAttachmentRecorderView: View {
    let onComplete: (MessageAttachment) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var recorder = VoiceRecorder()

    var body: some View {
        NavigationStack {
            VStack(spacing: 24) {
                Image(systemName: recorder.isRecording ? "waveform.circle.fill" : "mic.circle")
                    .font(.system(size: 72))
                    .foregroundStyle(recorder.isRecording ? .red : .blue)
                    .accessibilityHidden(true)
                Text(recorder.duration, format: .number.precision(.fractionLength(1))) + Text(" 秒")
                    .font(.title.monospacedDigit())
                Text(recorder.statusText)
                    .foregroundStyle(.secondary)
                if recorder.hasRecoverableInterruption {
                    Text("录音被系统中断，已自动暂停。可以继续录音或保存当前内容。")
                        .font(.footnote)
                        .foregroundStyle(.orange)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                }
                HStack(spacing: 16) {
                    if recorder.isRecording {
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
                        Button("完成", systemImage: "checkmark") { complete() }
                            .buttonStyle(.borderedProminent)
                    } else {
                        Button("开始录音", systemImage: "mic.fill") { Task { await recorder.start() } }
                            .buttonStyle(.borderedProminent)
                    }
                }
                if recorder.isMicrophonePermissionDenied {
                    Text("未获得麦克风权限，请在系统设置中允许访问。")
                        .font(.footnote)
                        .foregroundStyle(.red)
                        .multilineTextAlignment(.center)
                    MicrophonePermissionSettingsButton()
                } else if let error = recorder.errorMessage {
                    Text(error).font(.footnote).foregroundStyle(.red).multilineTextAlignment(.center)
                }
            }
            .padding()
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .navigationTitle("语音")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { recorder.cancel(); dismiss() }
                }
            }
            .onDisappear { recorder.cancel() }
            .onReceive(NotificationCenter.default.publisher(for: AVAudioSession.interruptionNotification)) {
                recorder.handleAudioInterruption($0)
            }
        }
        .presentationDetents([.medium])
    }

    private func complete() {
        guard let attachment = recorder.finishAttachment() else { return }
        onComplete(attachment)
        dismiss()
    }
}

@MainActor
@Observable
final class VoiceRecorder: NSObject, AVAudioRecorderDelegate {
    private(set) var isRecording = false
    private(set) var isPaused = false
    private(set) var isMicrophonePermissionDenied = false
    private(set) var hasRecoverableInterruption = false
    private(set) var duration = 0.0
    private(set) var errorMessage: String?

    private var recorder: AVAudioRecorder?
    private var timer: Timer?
    private var fileURL: URL?

    var statusText: LocalizedStringResource {
        if isPaused {
            return "录音已暂停"
        }
        if isRecording {
            return "正在录音"
        }
        return "准备录音"
    }

    func start() async {
        let allowed = await AVAudioApplication.requestRecordPermission()
        guard allowed else {
            isMicrophonePermissionDenied = true
            errorMessage = "未获得麦克风权限，请在系统设置中允许访问。"
            return
        }
        isMicrophonePermissionDenied = false
        hasRecoverableInterruption = false
        do {
            let url = FileManager.default.temporaryDirectory
                .appending(path: "xopc-voice-\(UUID().uuidString).wav")
            let recorder = try AVAudioRecorder(url: url, settings: [
                AVFormatIDKey: Int(kAudioFormatLinearPCM),
                AVSampleRateKey: 16000,
                AVNumberOfChannelsKey: 1,
                AVLinearPCMBitDepthKey: 16,
                AVLinearPCMIsBigEndianKey: false,
                AVLinearPCMIsFloatKey: false
            ])
            recorder.delegate = self
            recorder.record()
            self.recorder = recorder
            fileURL = url
            isRecording = true
            isPaused = false
            errorMessage = nil
            timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
                Task { @MainActor in self?.duration = recorder.currentTime }
            }
            scheduleInterruptionForUITest()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func togglePause() {
        guard let recorder else { return }
        if isPaused {
            recorder.record()
            hasRecoverableInterruption = false
        } else {
            recorder.pause()
        }
        isPaused.toggle()
    }

    func finishAttachment() -> MessageAttachment? {
        guard let audio = finishRecording() else { return nil }
        return MessageAttachment(
            type: "audio",
            name: audio.fileName,
            mimeType: audio.mimeType,
            size: audio.data.count,
            data: audio.data.base64EncodedString()
        )
    }

    func finishRecording(retainSource: Bool = false) -> RecordedAudio? {
        recorder?.stop()
        timer?.invalidate()
        isRecording = false
        guard let fileURL, let recordedData = try? Data(contentsOf: fileURL) else {
            errorMessage = "无法读取录音文件"
            return nil
        }
        let data = spokenAudioForUITest()
            ?? CanonicalWav.normalizedPCM16Mono(recordedData)
            ?? syntheticAudioForUITest()
        guard let data else {
            errorMessage = "录音未包含可用音频"
            return nil
        }
        if !retainSource {
            try? FileManager.default.removeItem(at: fileURL)
            self.fileURL = nil
        }
        return RecordedAudio(
            data: data,
            fileName: "语音消息.wav",
            mimeType: "audio/wav",
            duration: Double(data.count - CanonicalWav.headerSize) / 32000
        )
    }

    func cancel() {
        recorder?.stop()
        timer?.invalidate()
        if let fileURL {
            try? FileManager.default.removeItem(at: fileURL)
            self.fileURL = nil
        }
        isRecording = false
        isPaused = false
        hasRecoverableInterruption = false
    }

    func handleAudioInterruption(_ notification: Notification) {
        guard isRecording, !isPaused,
              let rawType = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
              rawType == AVAudioSession.InterruptionType.began.rawValue
        else { return }
        recorder?.pause()
        isPaused = true
        hasRecoverableInterruption = true
    }

    private func syntheticAudioForUITest() -> Data? {
        guard ProcessInfo.processInfo.environment["XOPC_UI_TEST_SYNTHETIC_AUDIO"] == "1" else { return nil }
        return CanonicalWav.silence(duration: max(duration, 1.2))
    }

    private func spokenAudioForUITest() -> Data? {
        guard let encoded = ProcessInfo.processInfo.environment["XOPC_UI_TEST_SPOKEN_AUDIO_BASE64"],
              let source = Data(base64Encoded: encoded)
        else { return nil }
        return CanonicalWav.normalizedPCM16Mono(source)
    }

    private func scheduleInterruptionForUITest() {
        guard ProcessInfo.processInfo.environment["XOPC_UI_TEST_AUDIO_INTERRUPTION"] == "1" else { return }
        Task { @MainActor [weak self] in
            try? await Task.sleep(for: .milliseconds(500))
            guard self?.isRecording == true else { return }
            NotificationCenter.default.post(
                name: AVAudioSession.interruptionNotification,
                object: AVAudioSession.sharedInstance(),
                userInfo: [AVAudioSessionInterruptionTypeKey: AVAudioSession.InterruptionType.began.rawValue]
            )
        }
    }
}

struct MicrophonePermissionSettingsButton: View {
    @Environment(\.openURL) private var openURL

    var body: some View {
        Button("打开设置", systemImage: "gear") {
            guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
            openURL(url)
        }
        .buttonStyle(.bordered)
        .accessibilityIdentifier("voice-open-settings")
    }
}

struct RecordedAudio: Sendable {
    let data: Data
    let fileName: String
    let mimeType: String
    let duration: Double
}

enum CanonicalWav {
    static let headerSize = 44

    static func normalizedPCM16Mono(_ source: Data) -> Data? {
        guard source.ascii(at: 0, count: 4) == "RIFF",
              source.ascii(at: 8, count: 4) == "WAVE"
        else { return nil }

        var offset = 12
        var validFormat = false
        var samples: Data?
        while offset + 8 <= source.count {
            guard let chunkSize = source.uint32LE(at: offset + 4) else { return nil }
            let size = Int(chunkSize)
            let contentOffset = offset + 8
            guard contentOffset + size <= source.count else { return nil }
            switch source.ascii(at: offset, count: 4) {
            case "fmt ":
                validFormat = source.uint16LE(at: contentOffset) == 1
                    && source.uint16LE(at: contentOffset + 2) == 1
                    && source.uint32LE(at: contentOffset + 4) == 16000
                    && source.uint16LE(at: contentOffset + 14) == 16
            case "data":
                samples = source.subdata(in: contentOffset ..< contentOffset + size)
            default:
                break
            }
            offset = contentOffset + size + size % 2
        }
        guard validFormat, let samples, !samples.isEmpty, samples.count.isMultiple(of: 2) else { return nil }

        return data(samples: samples)
    }

    static func silence(duration: TimeInterval) -> Data {
        data(samples: Data(repeating: 0, count: Int(duration * 16000) * 2))
    }

    private static func data(samples: Data) -> Data {
        var output = Data("RIFF".utf8)
        output.appendUInt32LE(UInt32(36 + samples.count))
        output.append(Data("WAVEfmt ".utf8))
        output.appendUInt32LE(16)
        output.appendUInt16LE(1)
        output.appendUInt16LE(1)
        output.appendUInt32LE(16000)
        output.appendUInt32LE(32000)
        output.appendUInt16LE(2)
        output.appendUInt16LE(16)
        output.append(Data("data".utf8))
        output.appendUInt32LE(UInt32(samples.count))
        output.append(samples)
        return output
    }
}

private extension Data {
    func ascii(at offset: Int, count: Int) -> String? {
        guard offset >= 0, offset + count <= self.count else { return nil }
        return String(data: subdata(in: offset ..< offset + count), encoding: .ascii)
    }

    func uint16LE(at offset: Int) -> UInt16? {
        guard offset >= 0, offset + 2 <= count else { return nil }
        return UInt16(self[offset]) | UInt16(self[offset + 1]) << 8
    }

    func uint32LE(at offset: Int) -> UInt32? {
        guard offset >= 0, offset + 4 <= count else { return nil }
        return UInt32(self[offset])
            | UInt32(self[offset + 1]) << 8
            | UInt32(self[offset + 2]) << 16
            | UInt32(self[offset + 3]) << 24
    }

    mutating func appendUInt16LE(_ value: UInt16) {
        append(UInt8(value & 0xFF))
        append(UInt8(value >> 8))
    }

    mutating func appendUInt32LE(_ value: UInt32) {
        append(UInt8(value & 0xFF))
        append(UInt8(value >> 8 & 0xFF))
        append(UInt8(value >> 16 & 0xFF))
        append(UInt8(value >> 24))
    }
}
