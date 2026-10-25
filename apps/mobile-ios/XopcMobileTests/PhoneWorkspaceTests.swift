import XCTest
@testable import XopcMobile

@MainActor final class PhoneWorkspaceTests: XCTestCase {
    func testPointerBackpressureKeepsFinalUp() {
        let queue = PhonePointerQueue()
        var sent: [String] = []
        queue.send = { phase, coordinateX, _, seq in sent.append("\(seq):\(phase):\(coordinateX)") }
        queue.pointer("down", x: 10, y: 10)
        for index in 0 ..< 400 {
            queue.pointer("move", x: index, y: 20)
        }
        queue.pointer("up", x: 500, y: 30)
        XCTAssertEqual(sent, ["1:down:10"])
        queue.ack(1); queue.ack(2); queue.ack(3)
        XCTAssertEqual(sent, ["1:down:10", "2:move:500", "3:up:500"])
        XCTAssertNil(queue.pendingSince)
    }

    func testCancelledInputDoesNotReviveOnOldAck() {
        let queue = PhonePointerQueue(); var sent: [String] = []; var cancelled = 0
        queue.send = { phase, _, _, _ in sent.append(phase) }; queue.cancelInput = { cancelled += 1 }
        queue.pointer("down", x: 0, y: 0); queue.pointer("up", x: 0, y: 0); queue.cancel(); queue.ack(1)
        XCTAssertEqual(sent, ["down"]); XCTAssertEqual(cancelled, 1)
        queue.pointer("down", x: 1, y: 1); queue.ack(1)
        XCTAssertEqual(sent, ["down", "down"])
    }

    func testAnnexBHandlesThreeAndFourBytePrefixes() {
        let units = PhoneVideo.nalUnits(Data([0, 0, 0, 1, 0x67, 1, 2, 0, 0, 1, 0x68, 3, 0, 0, 0, 1, 0x65, 4]))
        XCTAssertEqual(units, [Data([0x67, 1, 2]), Data([0x68, 3]), Data([0x65, 4])])
        XCTAssertTrue(PhoneVideo.nalUnits(Data([1, 2, 3])).isEmpty)
    }

    func testControlStateDecodesRestoredAssistance() throws {
        let data = Data(#"{"report":{"sessionId":"phone","controlEpoch":7,"mode":"control","status":"needs_user","reconnectRequired":true},"ownControl":false,"textInput":"manual"}"#.utf8)
        let state = try JSONDecoder().decode(PhoneLiveState.self, from: data)
        XCTAssertEqual(state.report.controlEpoch, 7); XCTAssertEqual(state.report.reconnectRequired, true)
        XCTAssertFalse(state.ownControl); XCTAssertEqual(state.textInput, "manual")
    }
}
