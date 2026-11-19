import SwiftUI

private struct ConnectedDeviceFolder: Decodable, Identifiable {
    let id: String
    let kind: String
    let label: String
}

private struct ConnectedDevice: Decodable, Identifiable {
    let id: String
    let name: String
    let kind: String
    let platform: String
    let endpointId: String?
    let availability: String
    let tools: Set<String>
    let folders: [ConnectedDeviceFolder]

    var offline: Bool { availability == "offline" }
}

private struct DeviceConnectionCatalog: Decodable {
    let currentDeviceId: String?
    let devices: [ConnectedDevice]
}

private struct DeviceConnectionChat: Decodable {
    let conversationId: String
    let agentId: String
}

private struct DeviceConnectionChatRequest: Encodable {
    let endpointId: String
}

struct DeviceConnectionsView: View {
    let configuration: GatewayConfiguration
    let active: Bool
    var onOpenChat: (String, String) -> Void
    var onShareFile: (MessageAttachment) async throws -> Void
    var onLocalTool: (String) -> Void
    var onPair: () -> Void

    @Environment(\.mobileTheme) private var theme
    @Environment(\.locale) private var locale
    @State private var catalog: DeviceConnectionCatalog?
    @State private var selectedID: String?
    @State private var loadFailed = false
    @State private var retry = 0
    @State private var requestRunning = false
    @State private var errorMessage: String?
    @State private var attachments: [MessageAttachment] = []
    @State private var showFile = false
    @State private var showPhoto = false
    @State private var showCamera = false

    private var zh: Bool { locale.identifier.hasPrefix("zh") }
    private var selected: ConnectedDevice? { catalog?.devices.first { $0.id == selectedID } }
    private var current: ConnectedDevice? { catalog?.devices.first { $0.id == catalog?.currentDeviceId } }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                if loadFailed || errorMessage != nil {
                    Text(errorMessage ?? word("设备暂不可用，请检查连接后重试。", "Devices are unavailable. Check your connection."))
                        .font(.footnote).foregroundStyle(theme.secondary)
                    Button(word("重试", "Retry")) { retry += 1; errorMessage = nil }
                        .foregroundStyle(theme.action)
                }
                if catalog == nil, !loadFailed {
                    ForEach(0..<3) { _ in
                        RoundedRectangle(cornerRadius: theme.corner(12)).fill(theme.panel)
                            .frame(height: 56).redacted(reason: .placeholder)
                    }
                } else if let selected {
                    detail(selected)
                } else if let catalog {
                    if let current { localDevice(current) }
                    computers(catalog.devices.filter { $0.kind == "desktop" })
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 18).padding(.vertical, 12)
        }
        .background(theme.canvas)
        .task(id: "\(active)-\(retry)") {
            guard active else { return }
            while !Task.isCancelled {
                do {
                    let response: GatewayEnvelope<DeviceConnectionCatalog> = try await GatewayClient(configuration: configuration)
                        .request(path: "/api/endpoint-tools/device-connections")
                    guard let payload = response.payload, response.isSuccessful else { throw DeviceConnectionUnavailable() }
                    catalog = payload
                    loadFailed = false
                } catch {
                    if Task.isCancelled { return }
                    loadFailed = true
                }
                do { try await Task.sleep(for: .seconds(5)) }
                catch { return }
            }
        }
        .modifier(AttachmentPickerModifier(scopeID: "device-connections", singleSelection: true, attachments: $attachments,
                                           errorMessage: $errorMessage, showingPhotoPicker: $showPhoto,
                                           showingFilePicker: $showFile, showingCameraPicker: $showCamera))
        .onChange(of: attachments) {
            guard let attachment = attachments.first else { return }
            attachments = []
            run { try await onShareFile(attachment) }
        }
    }

    private func word(_ chinese: String, _ english: String) -> String { zh ? chinese : english }

    @ViewBuilder
    private func localDevice(_ device: ConnectedDevice) -> some View {
        Text(word("当前设备", "Current device")).font(.subheadline.weight(.semibold)).foregroundStyle(theme.secondary)
        VStack(spacing: 0) {
            row(device.name, word("本机", "This phone"), "iphone", actionable: false)
            let tools = [
                ("mobile.file.pick", word("文件", "Files"), word("从系统文件中选择", "Choose from system files"), "folder"),
                ("mobile.media.pick", word("照片", "Photos"), word("从系统相册中选择", "Choose a photo"), "photo"),
                ("mobile.contacts.pick", word("联系人", "Contacts"), word("选择一个电话或邮箱", "Choose a number or email"), "person.crop.rectangle"),
                ("mobile.calendar.query_events", word("日历", "Calendar"), word("使用时请求授权", "Asks for access when used"), "calendar"),
                ("mobile.device.get_location", word("位置", "Location"), word("按次共享位置", "Share your location once"), "location")
            ]
            ForEach(tools.filter { device.tools.contains($0.0) }, id: \.0) { tool in
                Divider().padding(.leading, 46)
                Button {
                    if tool.0 == "mobile.file.pick" { showFile = true }
                    else if tool.0 == "mobile.media.pick" { showPhoto = true }
                    else { onLocalTool(tool.0) }
                } label: {
                    row(tool.1, tool.2, tool.3)
                }.buttonStyle(.plain).disabled(requestRunning).accessibilityIdentifier("device-tool-\(tool.0)")
            }
        }
        .background(theme.panel, in: .rect(cornerRadius: theme.corner(14)))
    }

    @ViewBuilder
    private func computers(_ devices: [ConnectedDevice]) -> some View {
        HStack {
            Text(word("已连接电脑", "Connected computers")).font(.subheadline.weight(.semibold)).foregroundStyle(theme.secondary)
            Spacer()
            Button(word("配对设备", "Pair device"), systemImage: "plus", action: onPair)
                .font(.footnote.weight(.semibold)).foregroundStyle(theme.action).frame(minHeight: 44)
        }
        VStack(spacing: 0) {
            if devices.isEmpty {
                Text(word("在电脑上打开 xopc，然后扫描配对码。", "Open xopc on your computer, then scan its pairing code."))
                    .font(.footnote).foregroundStyle(theme.secondary).padding(12)
            }
            ForEach(devices) { device in
                if device.id != devices.first?.id { Divider().padding(.leading, 46) }
                Button { selectedID = device.id; errorMessage = nil } label: {
                    row(device.name, "\(device.platform) · \(status(device))", device.platform == "darwin" ? "laptopcomputer" : "desktopcomputer")
                }.buttonStyle(.plain).accessibilityIdentifier("connected-device-\(device.id)")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.panel, in: .rect(cornerRadius: theme.corner(14)))
    }

    @ViewBuilder
    private func detail(_ device: ConnectedDevice) -> some View {
        Button { selectedID = nil; errorMessage = nil } label: {
            Label(word("返回设备连接", "Back to devices"), systemImage: "chevron.left")
        }.foregroundStyle(theme.action).frame(minHeight: 44)
        Text(device.name).font(.title2.weight(.semibold))
        Text("\(device.platform) · \(status(device))").font(.subheadline).foregroundStyle(theme.secondary)
        if device.offline {
            Label(word("在这台电脑上打开 xopc 并检查网络连接。", "Open xopc on this computer and check its connection."), systemImage: "wifi.slash")
                .font(.subheadline).foregroundStyle(theme.secondary).padding(12)
                .background(theme.panel, in: .rect(cornerRadius: theme.corner(14)))
        } else {
            Text(word("本地文件", "Local files")).font(.subheadline.weight(.semibold))
            VStack(spacing: 0) {
                let presets = [("desktop", word("桌面", "Desktop"), "desktopcomputer"),
                               ("documents", word("文稿", "Documents"), "folder"),
                               ("downloads", word("下载", "Downloads"), "arrow.down.to.line")]
                ForEach(presets, id: \.0) { kind, title, symbol in
                    if kind != "desktop" { Divider().padding(.leading, 46) }
                    row(title, device.folders.contains { $0.kind == kind } ? word("已授权 · 只读", "Authorized · Read-only")
                        : word("需在电脑上授权", "Authorize on computer"), symbol, actionable: false)
                }
                ForEach(device.folders.filter { $0.kind == "custom" }) { folder in
                    Divider().padding(.leading, 46)
                    row(folder.label, word("已授权 · 只读", "Authorized · Read-only"), "folder", actionable: false)
                }
            }.background(theme.panel, in: .rect(cornerRadius: theme.corner(14)))
            if device.platform == "darwin" || device.platform == "win32" {
                Text(word("电脑控制", "Computer use")).font(.subheadline.weight(.semibold))
                row(word("操作应用窗口", "Operate application windows"), word("在电脑的设置中授权", "Authorize in settings on the computer"),
                    "cursorarrow", actionable: false)
                    .background(theme.panel, in: .rect(cornerRadius: theme.corner(14)))
            }
            Button {
                guard let endpoint = device.endpointId else { return }
                run {
                    let result: GatewayEnvelope<DeviceConnectionChat> = try await GatewayClient(configuration: configuration)
                        .request(path: "/api/endpoint-tools/device-connections/chat", method: "POST",
                                 body: JSONEncoder().encode(DeviceConnectionChatRequest(endpointId: endpoint)))
                    guard result.isSuccessful, let chat = result.payload else { throw DeviceConnectionUnavailable() }
                    onOpenChat(chat.conversationId, chat.agentId)
                }
            } label: {
                Label(word("在聊天中使用", "Use in chat"), systemImage: "bubble.left")
                    .frame(maxWidth: .infinity, minHeight: 40)
            }
            .buttonStyle(.borderedProminent)
            .tint(theme.action)
            .disabled(loadFailed || requestRunning || device.endpointId == nil || device.folders.isEmpty)
            .accessibilityIdentifier("device-use-in-chat")
        }
    }

    private func status(_ device: ConnectedDevice) -> String {
        device.offline ? word("离线", "Offline") : word("在线", "Online")
    }

    private func row(_ title: String, _ subtitle: String, _ symbol: String, actionable: Bool = true) -> some View {
        HStack(spacing: 10) {
            Image(systemName: symbol).frame(width: 26).foregroundStyle(theme.secondary).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.subheadline.weight(.medium))
                Text(subtitle).font(.footnote).foregroundStyle(theme.secondary)
            }
            Spacer(minLength: 0)
            if actionable { Image(systemName: "chevron.right").font(.caption).foregroundStyle(theme.secondary).accessibilityHidden(true) }
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
        .frame(minHeight: 50).contentShape(.rect)
    }

    private func run(_ operation: @escaping @MainActor () async throws -> Void) {
        guard !requestRunning else { return }
        requestRunning = true
        errorMessage = nil
        Task { @MainActor in
            defer { requestRunning = false }
            do { try await operation() }
            catch is CancellationError {}
            catch { errorMessage = word("无法完成操作，请检查设备和授权。", "Unable to complete the action. Check the device and its access.") }
        }
    }
}

private struct DeviceConnectionUnavailable: Error {}
