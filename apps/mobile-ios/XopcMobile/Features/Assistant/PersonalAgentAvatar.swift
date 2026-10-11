import SwiftUI

struct PersonalAgentAvatar: View {
    let configuration: GatewayConfiguration
    let agent: PersonalAgentRecord?
    let size: CGFloat
    let active: Bool

    @State private var picture: UIImage?

    var body: some View {
        Group {
            if let picture, agent?.appearance == "custom" {
                Image(uiImage: picture)
                    .resizable()
                    .scaledToFill()
                    .frame(width: size, height: size)
                    .clipShape(Circle())
            } else {
                LoopiIcon(size: size, active: active, interactive: false)
            }
        }
        .task(id: AvatarLoadKey(configuration: configuration, agentID: agent?.agentId, appearance: agent?.appearance, revision: agent?.revision)) {
            picture = nil
            guard let agent, agent.appearance == "custom", !agent.agentId.isEmpty else { return }
            guard let encodedID = agent.agentId.addingPercentEncoding(
                withAllowedCharacters: CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~")
            ) else { return }
            do {
                let data = try await GatewayClient(configuration: configuration)
                    .requestData(path: "/api/agents/\(encodedID)/avatar")
                guard !Task.isCancelled, !data.isEmpty, data.count <= 512 * 1024 else { return }
                picture = UIImage(data: data)
            } catch {
                // The built-in avatar remains available if a custom image cannot load.
            }
        }
    }
}

private struct AvatarLoadKey: Hashable {
    let configuration: GatewayConfiguration
    let agentID: String?
    let appearance: String?
    let revision: Int?
}

struct ConfiguredAgentAvatar: View {
    let configuration: GatewayConfiguration
    let agent: AgentSummary?
    let size: CGFloat
    let active: Bool
    @State private var picture: UIImage?

    var body: some View {
        Group {
            if let picture {
                Image(uiImage: picture).resizable().scaledToFill().frame(width: size, height: size).clipShape(Circle())
            } else if agent?.avatar?.hasPrefix("xopc:loopi:") == true {
                LoopiIcon(size: size, active: active)
            } else {
                Text(verbatim: String((agent?.id ?? "").prefix(1)).uppercased())
                    .frame(width: size, height: size).background(Color.accentColor.opacity(0.12), in: Circle())
            }
        }
        .accessibilityHidden(true)
        .task(id: ConfiguredAvatarKey(configuration: configuration, agentID: agent?.id, reference: agent?.avatar)) {
            picture = nil
            guard let agent, !agent.id.isEmpty, agent.avatar?.hasPrefix("xopc:loopi:") != true else { return }
            do {
                let data: Data
                if let reference = agent.avatar, let url = URL(string: reference), url.scheme == "https" {
                    var request = URLRequest(url: url)
                    request.timeoutInterval = 12
                    let (bytes, response) = try await URLSession.shared.data(for: request)
                    guard (response as? HTTPURLResponse)?.statusCode == 200 else { return }
                    data = bytes
                } else {
                    let id = agent.id.addingPercentEncoding(withAllowedCharacters: CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~")) ?? ""
                    data = try await GatewayClient(configuration: configuration).requestData(path: "/api/agents/\(id)/avatar?resolve=1")
                }
                guard !Task.isCancelled, !data.isEmpty, data.count <= 512 * 1024 else { return }
                picture = UIImage(data: data)
            } catch { /* Preserve the agent identity while the picture is unavailable. */ }
        }
    }
}

private struct ConfiguredAvatarKey: Hashable {
    let configuration: GatewayConfiguration
    let agentID: String?
    let reference: String?
}
