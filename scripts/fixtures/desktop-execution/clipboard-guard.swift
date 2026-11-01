import AppKit
import Foundation
import Darwin

// Acceptance-only: preserve all materialized pasteboard formats in memory, never in logs or files.
let board = NSPasteboard.general
let expected = CommandLine.arguments[1]
let initialCount = board.changeCount
var snapshot: [[NSPasteboard.PasteboardType: Data]] = []
var bytes = 0
for item in board.pasteboardItems ?? [] {
    guard snapshot.count < 16, item.types.count <= 128 else { exit(2) }
    var entry: [NSPasteboard.PasteboardType: Data] = [:]
    for type in item.types {
        guard let data = item.data(forType: type) else { exit(2) }
        bytes += data.count
        guard bytes <= 8 * 1024 * 1024 else { exit(2) }
        entry[type] = data
    }
    snapshot.append(entry)
}
guard board.changeCount == initialCount else { exit(2) }
func emit(_ value: [String: Bool]) {
    let data = try! JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    FileHandle.standardOutput.write(data + Data([10]))
}
emit(["ready": true])
let flags = fcntl(STDIN_FILENO, F_GETFL)
_ = fcntl(STDIN_FILENO, F_SETFL, flags | O_NONBLOCK)
let deadline = ProcessInfo.processInfo.systemUptime + 1800
var observed = false
while ProcessInfo.processInfo.systemUptime < deadline {
    if !observed && board.string(forType: .string) == expected { observed = true; emit(["observed": true]) }
    var input = [UInt8](repeating: 0, count: 128)
    let count = read(STDIN_FILENO, &input, input.count)
    if count == 0 || count > 0 && String(decoding: input.prefix(Int(count)), as: UTF8.self).contains("restore") { break }
    Thread.sleep(forTimeInterval: 0.1)
}
if board.changeCount == initialCount {
    emit(["restored": true, "unchanged": true, "observed": observed])
} else if board.string(forType: .string) == expected {
    let items = snapshot.map { entry -> NSPasteboardItem in
        let item = NSPasteboardItem()
        for (type, data) in entry { item.setData(data, forType: type) }
        return item
    }
    board.clearContents()
    let written = items.isEmpty || board.writeObjects(items)
    let restored = board.pasteboardItems ?? []
    let equal = restored.count == snapshot.count && restored.enumerated().allSatisfy { index, item in
        Set(item.types) == Set(snapshot[index].keys) && snapshot[index].allSatisfy { type, data in item.data(forType: type) == data }
    }
    emit(["restored": written && equal, "observed": observed])
} else {
    // Another application owns newer clipboard content. Never replace it with the saved snapshot.
    emit(["restored": false, "externalChange": true, "observed": observed])
}
