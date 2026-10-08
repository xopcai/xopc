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
        .task(id: AvatarLoadKey(configuration: configuration, agentID: agent?.agentId, appearance: agent?.appearance)) {
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
}
