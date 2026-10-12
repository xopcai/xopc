import CryptoKit
import Foundation
import XCTest
@testable import XopcMobile

final class DeviceRequestProofTests: XCTestCase {
    func testGatewayP256VerificationVector() throws {
        let message = [
            "xopc-request-v1",
            "11111111-1111-4111-8111-111111111111",
            "d47214a4ddd968f6ab36b8f51398d244eafdc228120711c6b2ea7b2e86442c70",
            "POST",
            "/api/sessions/test/inputs?q=%E4%BD%A0%E5%A5%BD&a=1&a=2",
            "1a33dac3264f3b6f7c9489738e3647d60d147c22d6dce8ec604d7b61629abc3d",
            "application/json",
            "22222222-2222-4222-8222-222222222222",
            "",
            "",
            "",
            "1791720000000",
            "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3"
        ].joined(separator: "\n")
        XCTAssertEqual(GatewayRequestProof.message(gatewayID: "11111111-1111-4111-8111-111111111111", credential: "xopc_at_test_vector",
                                                   method: "POST", target: "/api/sessions/test/inputs?q=%E4%BD%A0%E5%A5%BD&a=1&a=2",
                                                   bodyHash: GatewayRequestProof.digest(Data("{\"text\":\"你好 👋\"}".utf8)),
                                                   headers: ["application/json", "22222222-2222-4222-8222-222222222222", "", "", ""],
                                                   timestamp: 1_791_720_000_000, nonce: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3"), message)
        let keyData = try XCTUnwrap(Data(base64Encoded: "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEjnMerjMejj+uFxTLzHbxNhOkATPCWeAMhzJB2bd8OC0McGu16nLQn8/0URG/flrmzaypJv/6YbMQCsWNQdm9kA=="))
        let key = try P256.Signing.PublicKey(derRepresentation: keyData)
        let signature = try P256.Signing.ECDSASignature(rawRepresentation: XCTUnwrap(Data(base64Encoded: "UyxgmOBtH53/dGJY+97peYmlCfOdZCT57GhH7SRJ0NkPPIL41lLrm6IXxBsF6dGqZbryeagl8e3G2hxqbhH7fQ==")))
        XCTAssertTrue(key.isValidSignature(signature, for: Data(message.utf8)))
        XCTAssertFalse(key.isValidSignature(signature, for: Data((message + "x").utf8)))
    }
}
