import A2UICore
import A2UISwiftUI
import BasicCatalogSwiftUI
import Foundation
import OrderedJSON
import SwiftUI

private struct ComparisonActionResponse: Decodable {
    let messages: [JSONValue]
}

private extension ChatProjectComparison {
    var protocolVersion: A2UIProtocolVersion {
        messagesV1 == nil ? .v09 : .v10
    }

    var renderKey: String {
        "\(protocolVersion.rawValue):\(surfaceId)"
    }
}

@MainActor
@Observable
private final class ComparisonRenderer {
    private static var patches = [String: [String: JSONValue]]()
    private static var order = [String]()

    let catalog: Catalog<ComponentImplementation>
    let processor: MessageProcessor
    private let surfaceId: String
    private let protocolVersion: A2UIProtocolVersion
    private let cacheKey: String
    private let gateway: GatewayClient
    private(set) var failed = false
    private var pending = false

    init(_ comparison: ChatProjectComparison, configuration: GatewayConfiguration) {
        surfaceId = comparison.surfaceId
        protocolVersion = comparison.protocolVersion
        cacheKey = comparison.renderKey
        gateway = GatewayClient(configuration: configuration)
        catalog = BasicCatalogImplementation.makeCatalog(version: protocolVersion)
        processor = MessageProcessor(catalog: catalog)
        processor.outboundListener = { [weak self] message in
            Task { @MainActor [weak self] in await self?.receive(message) }
        }
        do {
            for message in comparison.messagesV1 ?? comparison.messages {
                try processor.processMessages(message)
            }
            for message in Self.patches[cacheKey]?.values ?? [:].values {
                try processor.processMessages(message)
            }
        } catch {
            failed = true
        }
    }

    private func receive(_ message: RendererToAgentMessage) async {
        if case .error = message {
            failed = true
        }
        guard case let .action(action) = message, action.version == protocolVersion,
              action.name == "inspectProject", action.surfaceID == surfaceId, !pending else { return }
        failed = false
        pending = true
        defer { pending = false }
        do {
            let response: ComparisonActionResponse = try await gateway.request(
                path: "/api/project-comparison/action", method: "POST", body: JSONEncoder().encode(message)
            )
            guard response.messages.count == 2 else { throw GatewayClientError.invalidResponse }
            let paths = try response.messages.map { packet in
                guard case let .object(fields) = packet, fields["version"] == .string(protocolVersion.rawValue),
                      case let .object(update) = fields["updateDataModel"], update["surfaceId"] == .string(surfaceId),
                      case let .string(path) = update["path"],
                      path.range(of: #"^/(selection|project_[0-3]/status)$"#, options: .regularExpression) != nil
                else { throw GatewayClientError.invalidResponse }
                return path
            }
            for packet in response.messages {
                try processor.processMessages(packet)
            }
            for (path, packet) in zip(paths, response.messages) {
                Self.patches[cacheKey, default: [:]][path] = packet
            }
            Self.order.removeAll { $0 == cacheKey }
            Self.order.append(cacheKey)
            if Self.order.count > 100 {
                Self.patches.removeValue(forKey: Self.order.removeFirst())
            }
        } catch {
            failed = true
        }
    }
}

struct ProjectComparisonPanel: View {
    let comparison: ChatProjectComparison
    let configuration: GatewayConfiguration
    @State private var renderer: ComparisonRenderer?

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if let renderer {
                ComparisonSurface(surfaceId: comparison.surfaceId, renderer: renderer, surfaces: renderer.processor.surfaceGroupModel)
                if renderer.failed {
                    Text("无法更新项目对比，请重试。").font(.caption).foregroundStyle(.secondary)
                }
            }
        }
        .accessibilityIdentifier("project-comparison-\(comparison.surfaceId)")
        .task(id: comparison.renderKey) {
            renderer = ComparisonRenderer(comparison, configuration: configuration)
        }
    }
}

private struct ComparisonSurface: View {
    let surfaceId: String
    let renderer: ComparisonRenderer
    @ObservedObject var surfaces: SurfaceGroupModel

    var body: some View {
        if let surface = surfaces.surfacesMap[surfaceId] {
            A2UISwiftUI.Surface(viewModel: surface, catalog: renderer.catalog)
        }
    }
}
