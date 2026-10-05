import Foundation
import Security

@MainActor
final class GatewayConfigurationStore {
    private let defaults: UserDefaults
    private let baseURLKey = "gateway.baseURL"
    private let keychainService = "ai.xopc.xopc.gateway"
    private let keychainAccount = "access-token"
    private let profilesKey = "gateway.profiles"
    private let activeProfileKey = "gateway.activeProfile"

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    func load() -> GatewayConfiguration {
        if let active = loadProfiles().first(where: { $0.id == defaults.string(forKey: activeProfileKey) }) {
            return configuration(for: active)
        }
        let storedURL = defaults.string(forKey: baseURLKey).flatMap(URL.init(string:))
        return GatewayConfiguration(
            baseURL: storedURL ?? .localGateway,
            token: loadToken() ?? ""
        )
    }

    func save(_ configuration: GatewayConfiguration) throws {
        defaults.set(configuration.baseURL.absoluteString, forKey: baseURLKey)
        try saveToken(configuration.token)
        var profiles = loadProfiles()
        if let index = profiles.firstIndex(where: { $0.baseURL == configuration.baseURL }) {
            try saveToken(configuration.token, account: profileTokenAccount(profiles[index].id))
            defaults.set(profiles[index].id, forKey: activeProfileKey)
        } else {
            let profile = GatewayProfile(
                id: UUID().uuidString.lowercased(),
                name: configuration.baseURL.host ?? "Gateway",
                baseURL: configuration.baseURL
            )
            profiles.insert(profile, at: 0)
            try persist(profiles)
            try saveToken(configuration.token, account: profileTokenAccount(profile.id))
            defaults.set(profile.id, forKey: activeProfileKey)
        }
    }

    func loadProfiles() -> [GatewayProfile] {
        guard let data = defaults.data(forKey: profilesKey),
              let profiles = try? JSONDecoder().decode([GatewayProfile].self, from: data),
              !profiles.isEmpty
        else {
            guard let url = defaults.string(forKey: baseURLKey).flatMap(URL.init(string:)) else { return [] }
            let profile = GatewayProfile(id: UUID().uuidString.lowercased(), name: url.host ?? "Gateway", baseURL: url)
            if let data = try? JSONEncoder().encode([profile]) {
                defaults.set(data, forKey: profilesKey)
                defaults.set(profile.id, forKey: activeProfileKey)
                if let token = loadToken() {
                    try? saveToken(token, account: profileTokenAccount(profile.id))
                }
            }
            return [profile]
        }
        return profiles
    }

    func activeProfileID() -> String? {
        defaults.string(forKey: activeProfileKey)
    }

    func configuration(profileID: String) -> GatewayConfiguration? {
        guard let profile = loadProfiles().first(where: { $0.id == profileID }) else { return nil }
        return configuration(for: profile)
    }

    func saveProfile(name: String, configuration: GatewayConfiguration) throws -> GatewayProfile {
        var profiles = loadProfiles()
        let profile: GatewayProfile
        if let index = profiles.firstIndex(where: { $0.baseURL == configuration.baseURL }) {
            profile = GatewayProfile(id: profiles[index].id, name: name, baseURL: configuration.baseURL)
            profiles[index] = profile
        } else {
            profile = GatewayProfile(id: UUID().uuidString.lowercased(), name: name, baseURL: configuration.baseURL)
            profiles.insert(profile, at: 0)
        }
        try saveToken(configuration.token, account: profileTokenAccount(profile.id))
        try persist(profiles)
        return profile
    }

    func activateProfile(id: String) throws -> GatewayConfiguration {
        guard let profile = loadProfiles().first(where: { $0.id == id }) else {
            throw GatewayConfigurationStoreError.profileNotFound
        }
        let configuration = configuration(for: profile)
        defaults.set(id, forKey: activeProfileKey)
        defaults.set(profile.baseURL.absoluteString, forKey: baseURLKey)
        try saveToken(configuration.token)
        return configuration
    }

    func renameProfile(id: String, name: String) throws {
        var profiles = loadProfiles()
        guard let index = profiles.firstIndex(where: { $0.id == id }) else {
            throw GatewayConfigurationStoreError.profileNotFound
        }
        profiles[index] = GatewayProfile(
            id: profiles[index].id,
            name: name,
            baseURL: profiles[index].baseURL
        )
        try persist(profiles)
    }

    func removeProfile(id: String) throws {
        var profiles = loadProfiles()
        profiles.removeAll { $0.id == id }
        try persist(profiles)
        try saveToken("", account: profileTokenAccount(id))
        if defaults.string(forKey: activeProfileKey) == id {
            if let next = profiles.first {
                _ = try activateProfile(id: next.id)
            } else {
                defaults.removeObject(forKey: activeProfileKey)
            }
        }
    }

    private func configuration(for profile: GatewayProfile) -> GatewayConfiguration {
        let profileToken = loadToken(account: profileTokenAccount(profile.id))
        return GatewayConfiguration(
            baseURL: profile.baseURL,
            token: profileToken ?? ""
        )
    }

    private func persist(_ profiles: [GatewayProfile]) throws {
        try defaults.set(JSONEncoder().encode(profiles), forKey: profilesKey)
    }

    private func profileTokenAccount(_ id: String) -> String {
        "profile-\(id)"
    }

    private func loadToken(account: String? = nil) -> String? {
        var query = keychainIdentity(account: account ?? keychainAccount)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data
        else {
            return nil
        }
        return String(data: data, encoding: .utf8)
    }

    private func saveToken(_ token: String, account: String? = nil) throws {
        let identity = keychainIdentity(account: account ?? keychainAccount)
        if token.isEmpty {
            let status = SecItemDelete(identity as CFDictionary)
            guard status == errSecSuccess || status == errSecItemNotFound else {
                throw GatewayConfigurationStoreError.keychain(status)
            }
            return
        }

        let attributes: [String: Any] = [
            kSecValueData as String: Data(token.utf8),
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        ]
        let updateStatus = SecItemUpdate(identity as CFDictionary, attributes as CFDictionary)
        if updateStatus == errSecItemNotFound {
            var item = identity
            attributes.forEach { item[$0.key] = $0.value }
            let addStatus = SecItemAdd(item as CFDictionary, nil)
            guard addStatus == errSecSuccess else {
                throw GatewayConfigurationStoreError.keychain(addStatus)
            }
        } else if updateStatus != errSecSuccess {
            throw GatewayConfigurationStoreError.keychain(updateStatus)
        }
    }

    private func keychainIdentity(account: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: account
        ]
    }
}

private extension String? {
    var trimmedNonEmpty: String? {
        let value = self?.trimmingCharacters(in: .whitespacesAndNewlines)
        return value?.isEmpty == false ? value : nil
    }
}

private extension URL {
    static let localGateway = URL(string: "http://127.0.0.1:18790")!
}

enum GatewayConfigurationStoreError: LocalizedError {
    case keychain(OSStatus)
    case profileNotFound

    var errorDescription: String? {
        switch self {
        case let .keychain(status):
            AppLocalization.resolve("无法将 Gateway 令牌保存到钥匙串（\(status)）")
        case .profileNotFound:
            AppLocalization.resolve("Gateway 配置不存在")
        }
    }
}

struct GatewayProfile: Codable, Identifiable, Hashable, Sendable {
    let id: String
    let name: String
    let baseURL: URL
}
