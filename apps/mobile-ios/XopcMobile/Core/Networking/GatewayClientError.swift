import Foundation

enum GatewayClientError: LocalizedError, Equatable {
    case invalidURL
    case invalidResponse
    case invalidPayload(String)
    case http(statusCode: Int, message: String?)
    case voiceSessionConflict(message: String?)
    case server(String)
    case transport

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            AppLocalization.resolve("Gateway 地址无效")
        case .invalidResponse:
            AppLocalization.resolve("Gateway 返回了无效响应")
        case let .invalidPayload(message):
            AppLocalization.resolve("无法解析 Gateway 响应：\(message)")
        case let .http(statusCode, message):
            message ?? AppLocalization.resolve("Gateway 请求失败（\(statusCode)）")
        case let .voiceSessionConflict(message):
            message ?? AppLocalization.resolve("Gateway 请求失败（\(409)）")
        case let .server(message):
            NSLocalizedString(message, comment: "Gateway error returned or generated at runtime")
        case .transport:
            AppLocalization.resolve("无法连接 Gateway，请检查地址、网络和服务状态")
        }
    }
}
