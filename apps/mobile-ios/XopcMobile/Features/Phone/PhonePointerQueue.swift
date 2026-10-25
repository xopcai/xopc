import Foundation

/// One acknowledged pointer at a time. MOVE coalesces; the last UP is retained.
@MainActor final class PhonePointerQueue {
    var send: (String, Int, Int, Int) -> Void = { _, _, _, _ in }
    var cancelInput: () -> Void = {}
    private var sequence = 0
    private var outstanding = 0
    private var held = false
    private var move: (Int, Int)?
    private var end: (Int, Int)?
    private(set) var pendingSince: Date?
    func pointer(_ phase: String, x: Int, y: Int) {
        if phase == "cancel" {
            cancel(); return
        }
        if phase == "down" {
            cancel(); held = true; dispatch(phase, x, y); return
        }
        guard held else { return }
        if phase == "move" {
            move = (x, y)
        }
        if phase == "up" {
            held = false; if move != nil {
                move = (x, y)
            }; end = (x, y)
        }
        drain()
    }

    func ack(_ seq: Int) {
        guard seq == outstanding else { return }
        outstanding = 0; pendingSince = nil; drain()
    }

    private func drain() {
        guard outstanding == 0 else { return }
        if let next = move {
            move = nil; dispatch("move", next.0, next.1)
        } else if let next = end {
            end = nil; dispatch("up", next.0, next.1)
        }
    }

    private func dispatch(_ phase: String, _ x: Int, _ y: Int) {
        sequence += 1; outstanding = sequence; pendingSince = Date(); send(phase, x, y, sequence)
    }

    func cancel() {
        let active = held || outstanding != 0 || end != nil
        held = false; outstanding = 0; move = nil; end = nil; pendingSince = nil
        if active {
            cancelInput()
        }
    }
}
