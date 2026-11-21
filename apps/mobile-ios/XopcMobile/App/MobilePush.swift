import SwiftUI
import UIKit
import UserNotifications

struct MobilePushClick: Decodable {
    let gatewayId: String
    let eventId: String

    static func decode(_ encoded: String) -> Self? {
        guard encoded.utf8.count <= 6_000 else { return nil }
        let base64 = encoded.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        let padding = String(repeating: "=", count: (4 - base64.count % 4) % 4)
        guard let bytes = Data(base64Encoded: base64 + padding),
              let click = try? JSONDecoder().decode(Self.self, from: bytes),
              validID(click.gatewayId), validID(click.eventId) else { return nil }
        return click
    }

    static func validID(_ value: String) -> Bool {
        value.range(of: #"^[A-Za-z0-9_.:-]{1,160}$"#, options: .regularExpression) != nil
    }
}

struct MobilePushTarget: Decodable {
    let kind: String
    let taskId: String?
    let runId: String?
    let conversationId: String?
}

private struct MobilePushRegistration: Encodable {
    let platform = "ios"
    let permissions = "granted"
    let pushToken: String
    let locale: String
    let environment: String
}

private struct MobilePushResponse: Decodable {
    let ok: Bool
    let target: MobilePushTarget?
}

@MainActor @Observable final class MobilePush {
    static let shared = MobilePush()
    private static let clicksKey = "push.pendingClicks"
    private let defaults = UserDefaults.standard
    private(set) var token: String?
    private(set) var pending = UserDefaults.standard.stringArray(forKey: "push.pendingClicks") ?? []
    private(set) var busy = Set<String>()
    private(set) var permissionBlocked = Set<String>()
    private(set) var awaitingToken: [String: UUID] = [:]
    private(set) var retryValue: [String: Bool] = [:]
    private(set) var errors: [String: String] = [:]
    private(set) var requested = Set<String>()
    private(set) var enabled = Set<String>()
    private var registration: [String: (token: String, at: Date)] = [:]

    private var environment: String? {
        guard let value = Bundle.main.object(forInfoDictionaryKey: "XopcApnsEnvironment") as? String,
              value == "production" || value == "sandbox" else { return nil }
        return value
    }

    private func preference(_ scope: String) -> String { "push.enabled." + scope }

    func restore(_ configuration: GatewayConfiguration) async {
        guard let scope = configuration.localIdentity, environment != nil, defaults.bool(forKey: preference(scope)) else { return }
        requested.insert(scope)
        // Ask APNs for the current token on each activation.
        UIApplication.shared.registerForRemoteNotifications()
        await sync(configuration)
    }

    func refreshPermission(_ configuration: GatewayConfiguration) async {
        guard let scope = configuration.localIdentity else { return }
        let status = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
        if status == .denied { permissionBlocked.insert(scope) }
        else { permissionBlocked.remove(scope) }
    }

    func setEnabled(_ value: Bool, configuration: GatewayConfiguration) async {
        guard let scope = configuration.localIdentity, !busy.contains(scope) else { return }
        errors[scope] = nil
        retryValue[scope] = value
        if value {
            guard environment != nil else {
                errors[scope] = AppLocalization.resolve("此构建缺少 iOS 推送配置。")
                return
            }
            busy.insert(scope)
            do {
                let allowed = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])
                busy.remove(scope)
                guard allowed else { permissionBlocked.insert(scope); return }
                permissionBlocked.remove(scope)
                defaults.set(true, forKey: preference(scope))
                requested.insert(scope)
                if token == nil { waitForToken(scope) }
                UIApplication.shared.registerForRemoteNotifications()
                await sync(configuration)
            } catch {
                busy.remove(scope)
                errors[scope] = AppLocalization.resolve("无法获取通知权限，请重试。")
            }
        } else {
            busy.insert(scope)
            defer { busy.remove(scope) }
            do {
                let _: MobilePushResponse = try await GatewayClient(configuration: configuration)
                    .request(path: "/api/devices/me/push", method: "DELETE", timeout: 15)
                defaults.removeObject(forKey: preference(scope))
                requested.remove(scope)
                enabled.remove(scope)
                registration[scope] = nil
            } catch { errors[scope] = AppLocalization.resolve("未能关闭通知，请检查 Gateway 连接后重试。") }
        }
    }

    private func waitForToken(_ scope: String) {
        let attempt = UUID()
        awaitingToken[scope] = attempt
        Task {
            try? await Task.sleep(for: .seconds(20))
            guard awaitingToken[scope] == attempt else { return }
            awaitingToken[scope] = nil
            errors[scope] = AppLocalization.resolve("暂时无法获取 iOS 推送标识，请重试。")
        }
    }

    func didRegister(_ bytes: Data) {
        let value = bytes.map { String(format: "%02x", $0) }.joined()
        if !value.isEmpty { token = value }
    }

    func didFailRegistration() {
        for scope in requested {
            awaitingToken[scope] = nil
            errors[scope] = AppLocalization.resolve("无法获取 iOS 推送标识，请重试。")
        }
    }

    func sync(_ configuration: GatewayConfiguration) async {
        guard let scope = configuration.localIdentity, requested.contains(scope),
              !busy.contains(scope) else { return }
        busy.insert(scope)
        defer { busy.remove(scope) }
        let status = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
        if status == .denied {
            permissionBlocked.insert(scope)
            awaitingToken[scope] = nil
            do {
                let _: MobilePushResponse = try await GatewayClient(configuration: configuration)
                    .request(path: "/api/devices/me/push", method: "DELETE", timeout: 15)
                enabled.remove(scope)
                registration[scope] = nil
                errors[scope] = "请在系统设置中允许通知。"
            } catch { errors[scope] = "未能同步通知权限，请检查 Gateway 连接后重试。" }
            return
        }
        permissionBlocked.remove(scope)
        guard status == .authorized || status == .provisional || status == .ephemeral, let token else { return }
        awaitingToken[scope] = nil
        retryValue[scope] = true
        if let recent = registration[scope], recent.token == token, Date().timeIntervalSince(recent.at) < 3600 { return }
        guard let environment else {
            errors[scope] = AppLocalization.resolve("此构建缺少 iOS 推送配置。")
            return
        }
        do {
            let locale = AppLocalization.selectedLocale.identifier.hasPrefix("zh") ? "zh" : "en"
            let payload = MobilePushRegistration(pushToken: token, locale: locale, environment: environment)
            let _: MobilePushResponse = try await GatewayClient(configuration: configuration)
                .request(path: "/api/devices/me/push", method: "PUT", body: JSONEncoder().encode(payload), timeout: 15,
                         mapHTTPError: { _, error in
                             switch error?.code {
                             case "PUSH_CLOUD_AUTH_REQUIRED": .server(AppLocalization.resolve("请在 Gateway 上重新授权 XOPC Cloud。"))
                             case "PUSH_PLATFORM_UNAVAILABLE": .server(AppLocalization.resolve("XOPC Cloud 暂时无法发送推送。"))
                             default: nil
                             }
                         })
            registration[scope] = (token, .now)
            enabled.insert(scope)
            errors[scope] = nil
        } catch let error as GatewayClientError {
            errors[scope] = error.localizedDescription
        } catch {
            errors[scope] = AppLocalization.resolve("注册通知失败，请重试。")
        }
    }

    func enqueue(_ route: String) {
        guard MobilePushClick.decode(route) != nil, !pending.contains(route) else { return }
        pending = Array((pending + [route]).suffix(32))
        defaults.set(pending, forKey: Self.clicksKey)
    }

    func forget(_ route: String) {
        pending.removeAll { $0 == route }
        defaults.set(pending, forKey: Self.clicksKey)
    }

    func acknowledge(_ eventID: String, using configuration: GatewayConfiguration) async throws -> MobilePushTarget? {
        let body = try JSONEncoder().encode(["surface": "mobile"])
        let result: MobilePushResponse = try await GatewayClient(configuration: configuration)
            .request(path: "/api/notifications/\(eventID)/ack", method: "POST", body: body, timeout: 15)
        return result.target
    }
}

final class MobilePushDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        MobilePush.shared.didRegister(deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        MobilePush.shared.didFailRegistration()
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .list, .sound]
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        guard response.actionIdentifier == UNNotificationDefaultActionIdentifier,
              let route = response.notification.request.content.userInfo["xopc_route"] as? String else { return }
        await MobilePush.shared.enqueue(route)
    }
}
