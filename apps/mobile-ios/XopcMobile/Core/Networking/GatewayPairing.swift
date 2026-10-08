// swiftlint:disable file_length
import CryptoKit
import Foundation
import Security

struct GatewayPairingInvitation: Codable, Sendable {
    let pairingID: String
    let pairingToken: String
    let gatewayID: String
    let gatewayPublicKey: String
    let origins: [URL]
    let expiresAt: Date

    static func parse(_ link: String, allowExpired: Bool = false) throws -> Self {
        let prefix = "https://link.xopc.ai/c#"
        let text = link.trimmingCharacters(in: .whitespacesAndNewlines)
        guard text.hasPrefix(prefix), text.count <= 16384,
              let data = Data(base64URL: String(text.dropFirst(prefix.count))), data.count >= 102
        else { throw GatewayPairingError.invalidInvitation }
        let bytes = [UInt8](data)
        var offset = 0
        func take(_ count: Int) throws -> [UInt8] {
            guard count >= 0, offset + count <= bytes.count else { throw GatewayPairingError.invalidInvitation }
            defer { offset += count }
            return Array(bytes[offset ..< offset + count])
        }
        guard try take(1) == [4] else { throw GatewayPairingError.invalidInvitation }
        let pairingID = try uuid(take(16))
        let secret = try Data(take(32)).base64URLEncodedString()
        let gatewayID = try uuid(take(16))
        let publicKey = try Data(take(32)).base64URLEncodedString()
        let expiry = try take(4).reduce(UInt64(0)) { ($0 << 8) | UInt64($1) }
        let count = try Int(take(1)[0])
        guard (1 ... 8).contains(count),
              allowExpired || expiry > UInt64(Date().timeIntervalSince1970)
        else {
            throw GatewayPairingError.invalidInvitation
        }
        var origins: [URL] = []
        for _ in 0 ..< count {
            let length = try take(2).reduce(0) { ($0 << 8) | Int($1) }
            let raw = try take(length)
            guard let string = String(bytes: raw, encoding: .ascii),
                  let url = URL(string: string),
                  url.scheme == "https", url.host != nil,
                  url.user == nil, url.password == nil, url.query == nil, url.fragment == nil,
                  url.path.isEmpty || url.path == "/",
                  url.port.map({ (1 ... 65535).contains($0) }) ?? true,
                  url.absoluteString == string,
                  !origins.contains(url)
            else { throw GatewayPairingError.invalidInvitation }
            origins.append(url)
        }
        guard offset == bytes.count else { throw GatewayPairingError.invalidInvitation }
        return Self(
            pairingID: pairingID,
            pairingToken: "xopc_pair_\(pairingID)_\(secret)",
            gatewayID: gatewayID,
            gatewayPublicKey: publicKey,
            origins: origins,
            expiresAt: Date(timeIntervalSince1970: TimeInterval(expiry))
        )
    }

    private static func uuid(_ bytes: [UInt8]) throws -> String {
        guard bytes.count == 16 else { throw GatewayPairingError.invalidInvitation }
        let hex = bytes.map { String(format: "%02x", $0) }.joined()
        return "\(hex.prefix(8))-\(hex.dropFirst(8).prefix(4))-\(hex.dropFirst(12).prefix(4))-\(hex.dropFirst(16).prefix(4))-\(hex.dropFirst(20))"
    }
}

struct GatewayPairedConnection: Sendable {
    let name: String
    let gatewayID: String
    let baseURL: URL
    let accessToken: String
    let accessTokenExpiresAt: Date
    let refreshToken: String
    let gatewayPublicKey: String
    let routes: [URL]
}

enum GatewayPairingError: LocalizedError {
    case invalidInvitation, identityMismatch, noVerifiedRoute, rejected, expired, invalidResponse, missingCredentials
    case authenticationDenied
    case keychain(OSStatus)

    var errorDescription: String? {
        switch self {
        case .invalidInvitation: "二维码或连接链接无效，或已过期。"
        case .identityMismatch: "Gateway 身份验证失败，请重新扫码。"
        case .noVerifiedRoute: "无法连接并验证 Gateway，请检查电脑网络。"
        case .rejected: "电脑端拒绝了连接请求。"
        case .expired: "连接请求已过期，请在电脑上重新生成二维码。"
        case .invalidResponse: "Gateway 返回了无效的配对响应。"
        case .missingCredentials: "设备凭据已丢失，请重新扫码连接。"
        case .authenticationDenied: "设备连接已被 Gateway 拒绝，请重新扫码连接。"
        case let .keychain(status): "无法保存设备凭据（钥匙串错误 \(status)）。"
        }
    }
}

private extension Data {
    init?(base64URL: String) {
        guard base64URL.range(of: "[^A-Za-z0-9_-]", options: .regularExpression) == nil,
              base64URL.count % 4 != 1
        else { return nil }
        let padded = base64URL.replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
            .padding(toLength: ((base64URL.count + 3) / 4) * 4, withPad: "=", startingAt: 0)
        self.init(base64Encoded: padded)
        guard base64URLEncodedString() == base64URL else { return nil }
    }

    func base64URLEncodedString() -> String {
        base64EncodedString().replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

enum GatewayPairingProof {
    static func message(action: String, body: [String: Any]) throws -> String {
        let data = try JSONSerialization.data(
            withJSONObject: body,
            options: [.sortedKeys, .fragmentsAllowed, .withoutEscapingSlashes]
        )
        guard let canonical = String(data: data, encoding: .utf8) else {
            throw GatewayPairingError.invalidResponse
        }
        return "xopc-device-pairing-v3\nPOST\n\(action)\n\(canonical)"
    }
}

@MainActor
// swiftlint:disable:next type_body_length
final class GatewayPairingService {
    static let shared = GatewayPairingService()

    private let keychainService = "ai.xopc.xopc.device-pairing"
    private var key: P256.Signing.PrivateKey?
    private var refreshTasks: [String: Task<GatewayPairedConnection?, Error>] = [:]

    // swiftlint:disable:next function_body_length
    func pair(link: String, onCode: @escaping @MainActor (String) -> Void) async throws -> GatewayPairedConnection {
        let normalizedLink = link.trimmingCharacters(in: .whitespacesAndNewlines)
        if let pending = loadJournal(), pending.link != normalizedLink {
            try? await cancelPending()
        }
        let saved = loadJournal()
        let invitation = try GatewayPairingInvitation.parse(normalizedLink, allowExpired: saved?.link == normalizedLink)
        if let pin = readSecret("identity:\(invitation.gatewayID)"),
           pin != invitation.gatewayPublicKey
        {
            throw GatewayPairingError.identityMismatch
        }
        let journal: PairingJournal
        if let saved, saved.link == normalizedLink {
            journal = saved
        } else {
            let origin = try await probe(invitation)
            journal = PairingJournal(
                link: normalizedLink, origin: origin,
                requestID: UUID().uuidString.lowercased(),
                idempotencyKey: UUID().uuidString.lowercased(),
                refreshToken: "xopc_rt_\(UUID().uuidString.lowercased())_\(random(32))",
                nextRefreshToken: "xopc_rt_\(UUID().uuidString.lowercased())_\(random(32))",
                refreshRequestID: UUID().uuidString.lowercased()
            )
            try saveJournal(journal)
        }
        let origin = journal.origin
        let requestID = journal.requestID
        let privateKey = try deviceKey()
        let publicBytes = [UInt8](privateKey.publicKey.x963Representation.dropFirst())
        let device: [String: Any] = [
            "displayName": "iPhone", "platform": "ios",
            "publicKeyJwk": [
                "kty": "EC", "crv": "P-256",
                "x": Data(publicBytes[0 ..< 32]).base64URLEncodedString(),
                "y": Data(publicBytes[32 ..< 64]).base64URLEncodedString()
            ]
        ]
        var response = try await pairingRequest(
            action: "request", invitation: invitation, origin: origin, requestID: requestID,
            extra: ["device": device]
        )
        while response.request.status == "pending" {
            onCode(response.request.confirmationCode ?? "")
            try await Task.sleep(for: .milliseconds(1500))
            try Task.checkCancellation()
            guard Date().timeIntervalSince1970 * 1000 < Double(response.request.expiresAt) else {
                throw GatewayPairingError.expired
            }
            response = try await pairingRequest(
                action: "status", invitation: invitation, origin: origin, requestID: requestID, extra: [:]
            )
        }
        guard ["approved", "completed"].contains(response.request.status) else {
            clearJournal()
            throw response.request.status == "expired" ? GatewayPairingError.expired : GatewayPairingError.rejected
        }
        response = try await pairingRequest(
            action: "complete", invitation: invitation, origin: origin, requestID: requestID,
            extra: ["idempotencyKey": journal.idempotencyKey, "initialRefreshToken": journal.refreshToken]
        )
        guard response.request.status == "completed", response.request.deviceId != nil,
              response.gateway.id == invitation.gatewayID,
              let routeRecords = response.routes, !routeRecords.isEmpty, routeRecords.count <= 8,
              routeRecords.contains(where: { $0.url == origin.absoluteString })
        else { throw GatewayPairingError.invalidResponse }
        let routes = try routeRecords.map { route -> URL in
            guard ["xopc-secure-link", "tailscale", "custom-https"].contains(route.kind),
                  !route.id.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  route.id.count <= 80,
                  let url = URL(string: route.url), url.scheme == "https", url.host != nil,
                  url.user == nil, url.password == nil, url.query == nil, url.fragment == nil,
                  url.path.isEmpty || url.path == "/",
                  url.absoluteString == route.url
            else { throw GatewayPairingError.invalidResponse }
            return url
        }
        guard Set(routeRecords.map(\.id)).count == routeRecords.count,
              Set(routes).count == routes.count
        else { throw GatewayPairingError.invalidResponse }
        try saveSecret(invitation.gatewayPublicKey, for: "identity:\(invitation.gatewayID)")
        return try await refresh(
            gatewayID: invitation.gatewayID, name: response.gateway.name,
            routes: [origin] + routes.filter { $0 != origin },
            publicKey: invitation.gatewayPublicKey, refreshToken: journal.refreshToken,
            nextToken: journal.nextRefreshToken, requestID: journal.refreshRequestID
        )
    }

    func cancelPending() async throws {
        guard let journal = loadJournal() else { return }
        defer { clearJournal() }
        let invitation = try GatewayPairingInvitation.parse(journal.link, allowExpired: true)
        _ = try await pairingRequest(
            action: "cancel", invitation: invitation, origin: journal.origin,
            requestID: journal.requestID, extra: [:]
        )
    }

    func clearJournal() {
        deleteSecret("pairing-journal")
    }

    func pendingLink() -> String? {
        loadJournal()?.link
    }

    func gatewayID(profileID: String) -> String? {
        guard let text = readSecret("profile:\(profileID)"),
              let data = Data(base64Encoded: text),
              let stored = try? JSONDecoder().decode(StoredPairing.self, from: data)
        else { return nil }
        return stored.gatewayID
    }

    private func loadJournal() -> PairingJournal? {
        guard let text = readSecret("pairing-journal"),
              let data = Data(base64Encoded: text)
        else { return nil }
        return try? JSONDecoder().decode(PairingJournal.self, from: data)
    }

    private func saveJournal(_ journal: PairingJournal) throws {
        try saveSecret(JSONEncoder().encode(journal).base64EncodedString(), for: "pairing-journal")
    }

    func save(_ connection: GatewayPairedConnection, profileID: String) throws {
        let stored = StoredPairing(
            gatewayID: connection.gatewayID, name: connection.name,
            origin: connection.baseURL, publicKey: connection.gatewayPublicKey,
            refreshToken: connection.refreshToken, routes: connection.routes
        )
        let data = try JSONEncoder().encode(stored)
        try saveSecret(data.base64EncodedString(), for: "profile:\(profileID)")
    }

    func remove(profileID: String) {
        refreshTasks[profileID]?.cancel()
        refreshTasks[profileID] = nil
        deleteSecret("profile:\(profileID)")
        deleteSecret("refresh-attempt:\(profileID)")
    }

    func refresh(profileID: String) async throws -> GatewayPairedConnection? {
        if let task = refreshTasks[profileID] {
            return try await task.value
        }
        let task = Task { try await refreshStoredProfile(profileID: profileID) }
        refreshTasks[profileID] = task
        defer { refreshTasks[profileID] = nil }
        return try await task.value
    }

    private func refreshStoredProfile(profileID: String) async throws -> GatewayPairedConnection? {
        guard let text = readSecret("profile:\(profileID)"),
              let data = Data(base64Encoded: text),
              let stored = try? JSONDecoder().decode(StoredPairing.self, from: data)
        else { return nil }
        let attemptKey = "refresh-attempt:\(profileID)"
        let attempt: RefreshAttempt
        if let value = readSecret(attemptKey), let data = Data(base64Encoded: value),
           let saved = try? JSONDecoder().decode(RefreshAttempt.self, from: data),
           saved.refreshToken == stored.refreshToken
        {
            attempt = saved
        } else {
            attempt = RefreshAttempt(
                refreshToken: stored.refreshToken,
                nextRefreshToken: "xopc_rt_\(UUID().uuidString.lowercased())_\(random(32))",
                requestID: UUID().uuidString.lowercased()
            )
            try saveSecret(JSONEncoder().encode(attempt).base64EncodedString(), for: attemptKey)
        }
        let connection = try await refresh(
            gatewayID: stored.gatewayID, name: stored.name,
            routes: [stored.origin] + stored.routes.filter { $0 != stored.origin },
            publicKey: stored.publicKey, refreshToken: stored.refreshToken,
            nextToken: attempt.nextRefreshToken, requestID: attempt.requestID
        )
        try save(connection, profileID: profileID)
        deleteSecret(attemptKey)
        return connection
    }

    private func probe(_ invitation: GatewayPairingInvitation) async throws -> URL {
        for origin in invitation.origins {
            do {
                let envelope = try await post(
                    ["pairingId": invitation.pairingID], to: origin,
                    path: "/api/device-pairing/probe"
                )
                let proof: ProbeProof = try verify(envelope, publicKey: invitation.gatewayPublicKey)
                guard proof.gatewayId == invitation.gatewayID,
                      proof.pairingId == invitation.pairingID,
                      abs(Date().timeIntervalSince1970 * 1000 - Double(proof.issuedAt)) < 300_000
                else { throw GatewayPairingError.identityMismatch }
                return origin
            } catch GatewayPairingError.identityMismatch {
                throw GatewayPairingError.identityMismatch
            } catch is CancellationError {
                throw CancellationError()
            } catch { continue }
        }
        throw GatewayPairingError.noVerifiedRoute
    }

    private func pairingRequest(
        action: String, invitation: GatewayPairingInvitation, origin: URL,
        requestID: String, extra: [String: Any]
    ) async throws -> PairingResponse {
        let nonce = random(24)
        let timestamp = Int(Date().timeIntervalSince1970 * 1000)
        var body: [String: Any] = [
            "gatewayId": invitation.gatewayID, "requestId": requestID,
            "pairingToken": invitation.pairingToken, "timestamp": timestamp, "nonce": nonce
        ]
        body.merge(extra) { _, new in new }
        let proof = try GatewayPairingProof.message(action: action, body: body)
        body["signature"] = try deviceKey().signature(for: Data(proof.utf8)).rawRepresentation.base64URLEncodedString()
        let path = action == "request" ? "/api/device-pairing/requests" : "/api/device-pairing/requests/\(requestID)/\(action)"
        let envelope = try await post(body, to: origin, path: path)
        let result: PairingResponse = try verify(envelope, publicKey: invitation.gatewayPublicKey)
        guard result.nonce == nonce, result.gateway.id == invitation.gatewayID,
              result.request.requestId == requestID
        else { throw GatewayPairingError.identityMismatch }
        return result
    }

    private func refresh(
        gatewayID: String, name: String, routes: [URL], publicKey: String, refreshToken: String,
        nextToken: String? = nil, requestID: String? = nil
    ) async throws -> GatewayPairedConnection {
        let parts = refreshToken.dropFirst("xopc_rt_".count).split(separator: "_")
        guard let credentialID = parts.first else { throw GatewayPairingError.missingCredentials }
        let nextToken = nextToken ?? "xopc_rt_\(UUID().uuidString.lowercased())_\(random(32))"
        let requestID = requestID ?? UUID().uuidString.lowercased()
        let refreshNonce = random(24)
        let timestamp = Int(Date().timeIntervalSince1970 * 1000)
        let proof = "xopc-device-refresh-v2\n\(credentialID)\n\(timestamp)\n\(refreshNonce)\n\(requestID)\n\(nextToken)"
        let body: [String: Any] = try [
            "refreshToken": refreshToken, "nextRefreshToken": nextToken,
            "requestId": requestID, "timestamp": timestamp, "nonce": refreshNonce,
            "signature": deviceKey().signature(for: Data(proof.utf8)).rawRepresentation.base64URLEncodedString()
        ]
        var lastError: Error = GatewayPairingError.noVerifiedRoute
        for origin in routes {
            try Task.checkCancellation()
            do {
                let nonce = random(24)
                let challenge = try await post(["nonce": nonce], to: origin, path: "/api/gateway-identity/challenge")
                let route: RouteProof = try verify(challenge, publicKey: publicKey)
                guard route.purpose == "gateway-route-v1", route.gatewayId == gatewayID,
                      route.nonce == nonce, Double(route.expiresAt) > Date().timeIntervalSince1970 * 1000
                else { throw GatewayPairingError.identityMismatch }
                let envelope = try await post(body, to: origin, path: "/api/device-auth/refresh")
                let result: RefreshProof = try verify(envelope, publicKey: publicKey)
                guard result.purpose == "device-refresh-v3", result.gatewayId == gatewayID,
                      result.nonce == refreshNonce, result.requestId == requestID,
                      result.tokens.refreshToken == nextToken,
                      result.tokens.accessTokenExpiresAt > timestamp
                else { throw GatewayPairingError.identityMismatch }
                return GatewayPairedConnection(
                    name: name, gatewayID: gatewayID, baseURL: origin,
                    accessToken: result.tokens.accessToken,
                    accessTokenExpiresAt: Date(timeIntervalSince1970: Double(result.tokens.accessTokenExpiresAt) / 1000),
                    refreshToken: nextToken, gatewayPublicKey: publicKey, routes: routes
                )
            } catch GatewayPairingError.identityMismatch {
                throw GatewayPairingError.identityMismatch
            } catch GatewayPairingError.authenticationDenied {
                throw GatewayPairingError.authenticationDenied
            } catch is CancellationError {
                throw CancellationError()
            } catch {
                lastError = error
            }
        }
        throw lastError
    }

    private func post(_ body: [String: Any], to origin: URL, path: String) async throws -> SignedEnvelope {
        var request = URLRequest(url: origin.appending(path: path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        request.timeoutInterval = 12
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw GatewayPairingError.noVerifiedRoute
        }
        if let failure = try? JSONDecoder().decode(PairingFailure.self, from: data) {
            switch failure.error.code {
            case "PAIRING_EXPIRED": throw GatewayPairingError.expired
            case "PAIRING_DENIED", "PAIRING_IDENTITY_MISMATCH": throw GatewayPairingError.identityMismatch
            case "PAIRING_REJECTED", "PAIRING_CANCELLED": throw GatewayPairingError.rejected
            case "REFRESH_DENIED": throw GatewayPairingError.authenticationDenied
            default: break
            }
        }
        if [401, 403].contains(http.statusCode) {
            throw GatewayPairingError.authenticationDenied
        }
        guard (200 ..< 300).contains(http.statusCode) else { throw GatewayPairingError.noVerifiedRoute }
        return try JSONDecoder().decode(SignedEnvelope.self, from: data)
    }

    private func verify<T: Decodable>(_ envelope: SignedEnvelope, publicKey: String) throws -> T {
        guard let keyData = Data(base64URL: publicKey), keyData.count == 32,
              let payload = Data(base64URL: envelope.signedPayload),
              let signature = Data(base64URL: envelope.signature),
              let key = try? Curve25519.Signing.PublicKey(rawRepresentation: keyData),
              key.isValidSignature(signature, for: Data(envelope.signedPayload.utf8))
        else { throw GatewayPairingError.identityMismatch }
        return try JSONDecoder().decode(T.self, from: payload)
    }

    private func random(_ count: Int) -> String {
        var data = Data(count: count)
        _ = data.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, count, $0.baseAddress!) }
        return data.base64URLEncodedString()
    }

    private func deviceKey() throws -> P256.Signing.PrivateKey {
        if let key {
            return key
        }
        let privateKey: P256.Signing.PrivateKey
        if let stored = readSecret("device-key"), let data = Data(base64Encoded: stored) {
            privateKey = try P256.Signing.PrivateKey(rawRepresentation: data)
        } else {
            privateKey = P256.Signing.PrivateKey()
            try saveSecret(privateKey.rawRepresentation.base64EncodedString(), for: "device-key")
        }
        key = privateKey
        return privateKey
    }

    private func readSecret(_ account: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var value: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &value) == errSecSuccess,
              let data = value as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private func saveSecret(_ value: String, for account: String) throws {
        let identity: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: account
        ]
        let attributes: [String: Any] = [
            kSecValueData as String: Data(value.utf8),
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        ]
        let status = SecItemUpdate(identity as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            var item = identity
            attributes.forEach { item[$0.key] = $0.value }
            let addStatus = SecItemAdd(item as CFDictionary, nil)
            guard addStatus == errSecSuccess else { throw GatewayPairingError.keychain(addStatus) }
        } else if status != errSecSuccess {
            throw GatewayPairingError.keychain(status)
        }
    }

    private func deleteSecret(_ account: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: account
        ]
        SecItemDelete(query as CFDictionary)
    }
}

private struct StoredPairing: Codable {
    let gatewayID: String
    let name: String
    let origin: URL
    let publicKey: String
    let refreshToken: String
    let routes: [URL]

    init(gatewayID: String, name: String, origin: URL, publicKey: String, refreshToken: String, routes: [URL]) {
        self.gatewayID = gatewayID
        self.name = name
        self.origin = origin
        self.publicKey = publicKey
        self.refreshToken = refreshToken
        self.routes = routes
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        gatewayID = try container.decode(String.self, forKey: .gatewayID)
        name = try container.decode(String.self, forKey: .name)
        origin = try container.decode(URL.self, forKey: .origin)
        publicKey = try container.decode(String.self, forKey: .publicKey)
        refreshToken = try container.decode(String.self, forKey: .refreshToken)
        routes = try container.decodeIfPresent([URL].self, forKey: .routes) ?? [origin]
    }
}

private struct RefreshAttempt: Codable {
    let refreshToken: String
    let nextRefreshToken: String
    let requestID: String
}

private struct PairingJournal: Codable {
    let link: String
    let origin: URL
    let requestID: String
    let idempotencyKey: String
    let refreshToken: String
    let nextRefreshToken: String
    let refreshRequestID: String
}

private struct SignedEnvelope: Decodable {
    let signedPayload: String
    let signature: String
}

private struct PairingFailure: Decodable {
    let error: Detail

    struct Detail: Decodable {
        let code: String
    }
}

private struct ProbeProof: Decodable {
    let gatewayId: String
    let pairingId: String
    let issuedAt: Int64
}

private struct RouteProof: Decodable {
    let purpose: String
    let gatewayId: String
    let nonce: String
    let expiresAt: Int64
}

private struct PairingResponse: Decodable {
    let request: PairingRequest
    let gateway: PairingGateway
    let nonce: String
    let routes: [PairingRoute]?
}

private struct PairingRequest: Decodable {
    let requestId: String
    let status: String
    let confirmationCode: String?
    let expiresAt: Int64
    let deviceId: String?
}

private struct PairingGateway: Decodable {
    let id: String
    let name: String
}

private struct PairingRoute: Decodable {
    let id: String
    let kind: String
    let url: String
}

private struct RefreshProof: Decodable {
    let purpose: String
    let gatewayId: String
    let nonce: String
    let requestId: String
    let tokens: RefreshTokens
}

private struct RefreshTokens: Decodable {
    let accessToken: String
    let accessTokenExpiresAt: Int64
    let refreshToken: String
    let refreshTokenExpiresAt: Int64
}
