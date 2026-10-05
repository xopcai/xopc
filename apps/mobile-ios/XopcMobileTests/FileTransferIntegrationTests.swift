import Foundation
import XCTest
@testable import XopcMobile

final class FileTransferIntegrationTests: XCTestCase {
    func testUploadConflictRenameAndDownloadAgainstGateway() async throws {
        guard let token = ProcessInfo.processInfo.environment["XOPC_E2E_GATEWAY_TOKEN"], !token.isEmpty else {
            throw XCTSkip("Gateway token is required for a reversible file transfer test")
        }
        let baseURL = try XCTUnwrap(URL(string: "http://127.0.0.1:18790"))
        let configuration = GatewayConfiguration(baseURL: baseURL, token: token)
        let client = GatewayClient(configuration: configuration)
        let space = try await client.fetchDefaultFileSpace()
        guard space.writable else { throw XCTSkip("Default file space is read-only") }

        let baseName = "xopc-ios-upload-e2e-\(UUID().uuidString.lowercased()).txt"
        let renamedName = FileUploadName.suggestedAlternative(to: baseName)
        let body = Data("iOS multipart upload round trip\n".utf8)
        let before = try await client.fetchFiles(spaceID: space.id)
        XCTAssertFalse(before.contains { $0.name == baseName || $0.name == renamedName })

        do {
            let first = try await client.uploadFile(
                spaceID: space.id, directory: "", name: baseName, mimeType: "text/plain", data: body
            )
            XCTAssertEqual(first.name, baseName)
            do {
                _ = try await client.uploadFile(
                    spaceID: space.id, directory: "", name: baseName, mimeType: "text/plain", data: body
                )
                XCTFail("Uploading a duplicate should return 409")
            } catch let error as GatewayClientError {
                guard case .http(statusCode: 409, message: _) = error else { throw error }
            }

            let renamed = try await client.uploadFile(
                spaceID: space.id, directory: "", name: renamedName, mimeType: "text/plain", data: body
            )
            XCTAssertEqual(renamed.name, renamedName)
            let downloaded = try await client.downloadFile(renamed)
            defer { try? FileManager.default.removeItem(at: downloaded.deletingLastPathComponent()) }
            XCTAssertEqual(try Data(contentsOf: downloaded), body)
        } catch {
            try await cleanup(client: client, spaceID: space.id, names: [baseName, renamedName], configuration: configuration)
            throw error
        }
        try await cleanup(client: client, spaceID: space.id, names: [baseName, renamedName], configuration: configuration)
        let after = try await client.fetchFiles(spaceID: space.id)
        XCTAssertFalse(after.contains { $0.name == baseName || $0.name == renamedName })
    }

    private func cleanup(
        client: GatewayClient,
        spaceID: String,
        names: Set<String>,
        configuration: GatewayConfiguration
    ) async throws {
        let candidates = try await client.fetchFiles(spaceID: spaceID).filter { names.contains($0.name) }
        for file in candidates {
            var request = URLRequest(url: configuration.baseURL.appending(path: "api/files/\(file.id)"))
            request.httpMethod = "DELETE"
            request.setValue("Bearer \(configuration.token)", forHTTPHeaderField: "Authorization")
            let (_, response) = try await URLSession.shared.data(for: request)
            XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        }
    }
}
