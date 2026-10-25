import XCTest
@testable import XopcMobile

@MainActor final class PhonePairingIntegrationTests: XCTestCase {
    func testSignedPhoneAccessWithIndependentSimulatorPairing() async throws {
        let environment = ProcessInfo.processInfo.environment
        guard let link = environment["XOPC_PHONE_PAIRING_LINK"], let conversationID = environment["XOPC_PHONE_CONVERSATION_ID"] else {
            throw XCTSkip("Requires an isolated simulator pairing approved by the acceptance runner")
        }
        let connection = try await GatewayPairingService.shared.pair(link: link, onCode: { _ in })
        let repository = PhoneRepository(client: GatewayClient(configuration: GatewayConfiguration(baseURL: connection.baseURL, token: connection.accessToken)))
        let supported = try await repository.supported()
        XCTAssertTrue(supported)
        var summary = try await repository.summary(conversationID)
        let deadline = Date().addingTimeInterval(60)
        while summary.access != "control" && Date() < deadline {
            try await Task.sleep(for: .milliseconds(500)); summary = try await repository.summary(conversationID)
        }
        XCTAssertEqual(summary.access, "control")
        let binding = try XCTUnwrap(summary.binding)
        let before = try await repository.state(conversationID)
        let original = try XCTUnwrap(before)
        let controlled = try await repository.command(binding, state: original, op: "takeover")
        XCTAssertTrue(controlled.ownControl)
        let ticket = try await repository.ticket(binding, state: controlled)
        var components = URLComponents(url: connection.baseURL, resolvingAgainstBaseURL: false)!
        components.scheme = "wss"; components.path = ticket.path; components.query = nil; components.fragment = nil
        let url = try XCTUnwrap(components.url)
        var request = URLRequest(url: url)
        request.setValue("xopc-phone-v1, \(ticket.ticket)", forHTTPHeaderField: "Sec-WebSocket-Protocol")
        let proof = try await GatewayPairingService.shared.connectionProof(url: url, ticket: ticket.ticket)
        XCTAssertNotNil(proof)
        request.setValue(proof, forHTTPHeaderField: "X-Xopc-Proof")
        let socket = URLSession.shared.webSocketTask(with: request); socket.resume()
        do {
            var receivedGeometry = false
            for _ in 0..<8 {
                let message = try await socket.receive()
                if case .string(let text) = message,
                   let object = try JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any] {
                    if object["type"] as? String == "geometry" { receivedGeometry = true; break }
                    XCTAssertNotEqual(object["type"] as? String, "fault")
                }
            }
            XCTAssertTrue(receivedGeometry)
            _ = try await repository.command(binding, state: controlled, op: "release")
            socket.cancel(with: .goingAway, reason: nil)
        } catch {
            socket.cancel(with: .goingAway, reason: nil)
            _ = try? await repository.command(binding, state: controlled, op: "release")
            throw error
        }
        let after = try await repository.state(conversationID)
        let released = try XCTUnwrap(after)
        XCTAssertFalse(released.ownControl)
        XCTAssertEqual(released.report.status, "paused")
        print("PHONE_ACCEPTANCE_REQUEST_VIEW")
        var viewSummary = try await repository.summary(conversationID)
        let viewDeadline = Date().addingTimeInterval(15)
        while viewSummary.access != "view" && Date() < viewDeadline {
            try await Task.sleep(for: .milliseconds(300)); viewSummary = try await repository.summary(conversationID)
        }
        XCTAssertEqual(viewSummary.access, "view")
        do {
            _ = try await repository.command(binding, state: released, op: "takeover")
            XCTFail("View-only access must reject takeover")
        } catch GatewayClientError.http(let code, _) { XCTAssertEqual(code, 403) }
        _ = try await repository.ticket(binding, state: released)
        print("PHONE_ACCEPTANCE_REQUEST_NONE")
        var denied = try await repository.summary(conversationID)
        let noneDeadline = Date().addingTimeInterval(15)
        while denied.access != "none" && Date() < noneDeadline {
            try await Task.sleep(for: .milliseconds(300)); denied = try await repository.summary(conversationID)
        }
        XCTAssertEqual(denied.access, "none")
        XCTAssertNil(denied.binding)
        XCTAssertNil(denied.deviceName)
    }
}
