import CryptoKit
import Foundation
import Security

actor DeviceEndpointPool {
    static let shared = DeviceEndpointPool()
    private var hosts: [GatewayConfiguration: DeviceEndpointHost] = [:]

    func host(for client: GatewayClient) async -> DeviceEndpointHost {
        let configuration = client.configuration
        if let host = hosts[configuration] {
            return host
        }
        var removed = hosts.keys.filter { $0.baseURL == configuration.baseURL }.compactMap { hosts.removeValue(forKey: $0) }
        if hosts.count >= 8, let key = hosts.keys.first, let evicted = hosts.removeValue(forKey: key) {
            removed.append(evicted)
        }
        let host = DeviceEndpointHost(client: client)
        hosts[configuration] = host
        for displaced in removed {
            await displaced.stop()
        }
        return host
    }

    func origin(for client: GatewayClient) async throws -> DeviceEndpointOrigin {
        let host = await host(for: client)
        return try await host.origin()
    }
}

struct DeviceEndpointOrigin: Encodable, Sendable {
    let type = "endpoint"
    let endpointId: String
    let token: String
    var supportsDeviceContext = false
    var supportsMultiQuestion = false

    private enum CodingKeys: String, CodingKey {
        case type, endpointId, token
    }

    var environment: DeviceTurnEnvironment? {
        guard supportsDeviceContext else { return nil }
        return DeviceTurnEnvironment(
            capturedAt: Int64(Date().timeIntervalSince1970 * 1000), timezone: TimeZone.current.identifier,
            locale: Locale.current.identifier.replacingOccurrences(of: "_", with: "-")
        )
    }
}

struct DeviceCompatibility: Decodable {
    let deviceId: String?
    let turnDeviceContextV1: Bool?
    let clarificationVersions: [Int]?
    let deviceLocationTasksV1: Bool?
    let mobilePersonalToolsV1: Bool?
    let mobileExtendedPersonalToolsV1: Bool?
    let deviceStateToolsV1: Bool?
    let endpointEnvironmentV1: Bool?

    var catalogJson: String {
        if deviceStateToolsV1 != true {
            return "[]"
        }
        if mobilePersonalToolsV1 == true {
            return mobileExtendedPersonalToolsV1 == true ? DeviceToolCatalog.personalJson : DeviceToolCatalog.basePersonalJson
        }
        if deviceLocationTasksV1 == true, mobileExtendedPersonalToolsV1 == true {
            return DeviceToolCatalog.json
        }
        return DeviceToolCatalog.stateJson
    }
}

extension Data {
    func base64URL() -> String {
        base64EncodedString().replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
}

extension DeviceEndpointHost {
    static func signingKey() throws -> P256.Signing.PrivateKey {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "ai.xopc.device-tools",
                                    kSecAttrAccount as String: "endpoint-p256", kSecReturnData as String: true]
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecSuccess, let data = result as? Data {
            return try P256.Signing.PrivateKey(rawRepresentation: data)
        }
        guard status == errSecItemNotFound else { throw GatewayClientError.server("无法读取设备身份") }
        let key = P256.Signing.PrivateKey()
        var item = query; item.removeValue(forKey: kSecReturnData as String)
        item[kSecValueData as String] = key.rawRepresentation
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        guard SecItemAdd(item as CFDictionary, nil) == errSecSuccess else { throw GatewayClientError.server("无法保存设备身份") }
        return key
    }
}
