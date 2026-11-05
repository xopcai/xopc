import Foundation

struct DeviceEndpointOrigin: Encodable, Sendable {
    let type = "endpoint"
    let endpointId: String
    let token: String
}

struct DeviceCompatibility: Decodable {
    let deviceId: String?
    let turnDeviceContextV1: Bool?
    let deviceLocationTasksV1: Bool?
    let mobilePersonalToolsV1: Bool?
    let deviceStateToolsV1: Bool?
    let endpointEnvironmentV1: Bool?

    var catalogJson: String {
        if deviceStateToolsV1 != true {
            return "[]"
        }
        if mobilePersonalToolsV1 == true {
            return DeviceToolCatalog.personalJson
        }
        if deviceLocationTasksV1 == true {
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
