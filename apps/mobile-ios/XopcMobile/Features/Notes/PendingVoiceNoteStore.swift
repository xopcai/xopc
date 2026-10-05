import CryptoKit
import Foundation

struct PendingVoiceNote: Codable, Sendable, Equatable {
    let clientRequestID: String
    let recordedAt: Int64
    let duration: Double
    let fileName: String
    let mimeType: String
    var noteID: String?

    init(audio: RecordedAudio, recordedAt: Int64? = nil) {
        clientRequestID = UUID().uuidString.lowercased()
        self.recordedAt = recordedAt ?? Int64(Date().timeIntervalSince1970 * 1000 - audio.duration * 1000)
        duration = audio.duration
        fileName = audio.fileName
        mimeType = audio.mimeType
    }
}

enum PendingVoiceNoteError: LocalizedError {
    case alreadyExists
    case audioMissing

    var errorDescription: String? {
        switch self {
        case .alreadyExists: "请先完成或丢弃此前保存的语音笔记。"
        case .audioMissing: "本地录音文件无法读取，请勿删除应用数据，并联系支持。"
        }
    }
}

actor PendingVoiceNoteStore {
    private let directory: URL
    private let metadataURL: URL
    private let audioURL: URL
    private let completedURL: URL

    init(gatewayURL: URL, rootDirectory: URL? = nil) {
        let root = rootDirectory ?? FileManager.default.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        )[0].appending(path: "VoiceNoteDrafts")
        let gatewayKey = SHA256.hash(data: Data(gatewayURL.absoluteString.utf8))
            .map { String(format: "%02x", $0) }.joined()
        directory = root.appending(path: gatewayKey, directoryHint: .isDirectory)
        metadataURL = directory.appending(path: "draft.json")
        audioURL = directory.appending(path: "recording.wav")
        completedURL = directory.appending(path: "completed.json")
    }

    func load() throws -> PendingVoiceNote? {
        let files = FileManager.default
        if files.fileExists(atPath: completedURL.path) {
            try clear()
            return nil
        }
        guard files.fileExists(atPath: metadataURL.path) else {
            if files.fileExists(atPath: audioURL.path) {
                let data = try Data(contentsOf: audioURL)
                guard CanonicalWav.normalizedPCM16Mono(data) != nil else {
                    throw PendingVoiceNoteError.audioMissing
                }
                let duration = Double(data.count - CanonicalWav.headerSize) / 32000
                let modified = (try? files.attributesOfItem(atPath: audioURL.path))?[.modificationDate] as? Date ?? .now
                let audio = RecordedAudio(data: data, fileName: "语音消息.wav", mimeType: "audio/wav", duration: duration)
                let recovered = PendingVoiceNote(
                    audio: audio,
                    recordedAt: Int64(modified.timeIntervalSince1970 * 1000 - duration * 1000)
                )
                try JSONEncoder().encode(recovered).write(to: metadataURL, options: .atomic)
                return recovered
            }
            return nil
        }
        guard files.fileExists(atPath: audioURL.path) else { throw PendingVoiceNoteError.audioMissing }
        return try JSONDecoder().decode(PendingVoiceNote.self, from: Data(contentsOf: metadataURL))
    }

    func save(_ audio: RecordedAudio) throws -> PendingVoiceNote {
        let files = FileManager.default
        guard !files.fileExists(atPath: metadataURL.path), !files.fileExists(atPath: audioURL.path) else {
            throw PendingVoiceNoteError.alreadyExists
        }
        try files.createDirectory(at: directory, withIntermediateDirectories: true)
        let pending = PendingVoiceNote(audio: audio)
        do {
            try audio.data.write(to: audioURL, options: .atomic)
        } catch {
            try? files.removeItem(at: audioURL)
            throw error
        }
        do {
            try JSONEncoder().encode(pending).write(to: metadataURL, options: .atomic)
        } catch {
            try? files.removeItem(at: audioURL)
            throw error
        }
        try? files.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: audioURL.path)
        return pending
    }

    func audio(for pending: PendingVoiceNote) throws -> RecordedAudio {
        guard FileManager.default.fileExists(atPath: audioURL.path) else {
            throw PendingVoiceNoteError.audioMissing
        }
        return try RecordedAudio(
            data: Data(contentsOf: audioURL),
            fileName: pending.fileName,
            mimeType: pending.mimeType,
            duration: pending.duration
        )
    }

    func update(_ pending: PendingVoiceNote) throws {
        guard FileManager.default.fileExists(atPath: audioURL.path) else {
            throw PendingVoiceNoteError.audioMissing
        }
        try JSONEncoder().encode(pending).write(to: metadataURL, options: .atomic)
    }

    @discardableResult
    func clearIfUploaded(noteID: String) throws -> Bool {
        guard FileManager.default.fileExists(atPath: metadataURL.path) else { return false }
        let pending = try JSONDecoder().decode(PendingVoiceNote.self, from: Data(contentsOf: metadataURL))
        guard pending.noteID == noteID else { return false }
        try clear()
        return true
    }

    func clear() throws {
        let files = FileManager.default
        if files.fileExists(atPath: metadataURL.path) {
            try files.moveItem(at: metadataURL, to: completedURL)
        }
        if files.fileExists(atPath: audioURL.path) {
            try files.removeItem(at: audioURL)
        }
        if files.fileExists(atPath: completedURL.path) {
            try files.removeItem(at: completedURL)
        }
    }
}
