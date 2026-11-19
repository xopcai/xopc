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
    let capabilities: [ReportedDeviceCapability]?

    var offline: Bool {
        availability == "offline"
    }
}

private struct ReportedDeviceCapability: Decodable, Identifiable {
    let name: String
    let title: String
    let titleZh: String
    let allowed: Bool
    var id: String {
        name
    }
}

private struct DeviceCapabilityChange: Codable {
    let toolName: String
    let allowed: Bool
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

    private var usesChinese: Bool {
        locale.identifier.hasPrefix("zh")
    }

    private var selected: ConnectedDevice? {
        catalog?.devices.first { $0.id == selectedID }
    }

    private var current: ConnectedDevice? {
        catalog?.devices.first { $0.id == catalog?.currentDeviceId }
    }

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
                    ForEach(0 ..< 3) { _ in
                        RoundedRectangle(cornerRadius: theme.corner(18)).fill(theme.panel)
                            .frame(height: 76).redacted(reason: .placeholder)
                    }
                } else if let selected {
                    detail(selected)
                } else if let catalog {
                    if let current {
                        localDevice(current)
                    }
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
                    if Task.isCancelled {
                        return
                    }
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
}

extension DeviceConnectionsView {
    private func word(_ chinese: String, _ english: String) -> String {
        usesChinese ? chinese : english
    }

    @ViewBuilder
    private func localDevice(_ device: ConnectedDevice) -> some View {
        Text(word("当前设备", "Current device")).font(.subheadline.weight(.semibold)).foregroundStyle(theme.secondary)
        VStack(spacing: 10) {
            card(device.name, word("本机", "This phone"), "iphone", actionable: false)
            let tools = [
                ("mobile.file.pick", word("文件", "Files"), word("从系统文件中选择", "Choose from system files"), "folder"),
                ("mobile.media.pick", word("照片", "Photos"), word("从系统相册中选择", "Choose a photo"), "photo.on.rectangle.angled"),
                ("mobile.contacts.pick", word("联系人", "Contacts"), word("选择一个电话或邮箱", "Choose a number or email"), "person.crop.rectangle"),
                ("mobile.calendar.query_events", word("日历", "Calendar"), word("使用时请求授权", "Asks for access when used"), "calendar"),
                ("mobile.device.get_location", word("位置", "Location"), word("按次共享位置", "Share your location once"), "mappin.and.ellipse")
            ]
            if let reported = device.capabilities {
                Text(word("允许当前 Gateway 使用", "Allow the current Gateway to use"))
                    .font(.subheadline.weight(.semibold)).foregroundStyle(theme.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if reported.isEmpty {
                    Text(word("设备连接后会在这里显示已上报的能力。", "Reported capabilities appear here when connected."))
                        .font(.footnote).foregroundStyle(theme.secondary)
                }
                ForEach(reported) { capability in
                    let local = tools.first { $0.0 == capability.name }
                    let row = capabilityRow(capability, symbol: local?.3 ?? capabilitySymbol(capability.name))
                    if local != nil {
                        row.onTapGesture {
                            if !requestRunning {
                                useLocal(capability.name)
                            }
                        }
                        .accessibilityAction(named: Text(word("在本机使用", "Use on this device"))) { useLocal(capability.name) }
                    } else {
                        row
                    }
                }
            } else {
                ForEach(tools.filter { device.tools.contains($0.0) }, id: \.0) { tool in
                    Button { useLocal(tool.0) } label: { card(tool.1, tool.2, tool.3) }
                        .buttonStyle(MobilePressStyle(radius: theme.corner(18)))
                        .disabled(requestRunning)
                        .accessibilityIdentifier("device-tool-\(tool.0)")
                }
            }
        }
    }

    private func useLocal(_ name: String) {
        switch name {
        case "mobile.file.pick": showFile = true
        case "mobile.media.pick": showPhoto = true
        default: onLocalTool(name)
        }
    }

    private func capabilitySymbol(_ name: String) -> String {
        if name.hasPrefix("mobile.calendar.") {
            return "calendar"
        }
        if name.hasPrefix("mobile.contacts.") {
            return "person.crop.rectangle"
        }
        if name.hasPrefix("mobile.media.") {
            return "photo.on.rectangle.angled"
        }
        if name == "mobile.camera.capture" {
            return "camera"
        }
        return name == "mobile.device.get_power" ? "battery.75percent" : "iphone"
    }

    private func capabilityRow(_ capability: ReportedDeviceCapability, symbol: String) -> some View {
        let title = usesChinese ? capability.titleZh : capability.title
        let status = capability.allowed ? word("已授权", "Authorized") : word("未授权", "Not authorized")
        return CapabilityCardLabel(title: title, description: status) {
            CapabilityLogo(reference: nil, origin: configuration.baseURL, label: "", symbol: symbol)
        } trailing: {
            Toggle(word("允许 Gateway 使用" + title, "Allow Gateway to use " + title),
                   isOn: Binding(get: { capability.allowed }, set: { allowed in
                       run {
                           if allowed {
                               try await DevicePersonalTools.shared.prepareCapabilityPermission(capability.name)
                           }
                           let payload = DeviceCapabilityChange(toolName: capability.name, allowed: allowed)
                           let result: GatewayEnvelope<DeviceCapabilityChange> = try await GatewayClient(configuration: configuration)
                               .request(path: "/api/endpoint-tools/device-connections", method: "PATCH", body: JSONEncoder().encode(payload))
                           guard result.isSuccessful else { throw DeviceConnectionUnavailable() }
                           retry += 1
                       }
                   }))
                   .labelsHidden().toggleStyle(.switch).tint(theme.action)
                   .disabled(loadFailed || requestRunning)
                   .accessibilityIdentifier("device-grant-\(capability.name)")
        }
        .background(theme.panel, in: .rect(cornerRadius: theme.corner(18)))
    }

    @ViewBuilder
    private func computers(_ devices: [ConnectedDevice]) -> some View {
        HStack {
            Text(word("已连接电脑", "Connected computers")).font(.subheadline.weight(.semibold)).foregroundStyle(theme.secondary)
            Spacer()
            Button(word("配对设备", "Pair device"), systemImage: "plus", action: onPair)
                .font(.footnote.weight(.semibold)).foregroundStyle(theme.action).frame(minHeight: 44)
        }
        VStack(spacing: 10) {
            if devices.isEmpty {
                Text(word("在电脑上打开 xopc，然后扫描配对码。", "Open xopc on your computer, then scan its pairing code."))
                    .font(.footnote).foregroundStyle(theme.secondary).padding(12)
            }
            ForEach(devices) { device in
                Button { selectedID = device.id; errorMessage = nil } label: {
                    card(device.name, "\(device.platform) · \(status(device))", computerSymbol(device))
                }
                .buttonStyle(MobilePressStyle(radius: theme.corner(18)))
                .accessibilityIdentifier("connected-device-\(device.id)")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private func detail(_ device: ConnectedDevice) -> some View {
        Button { selectedID = nil; errorMessage = nil } label: {
            Label(word("返回设备连接", "Back to devices"), systemImage: "chevron.left")
        }.foregroundStyle(theme.action).frame(minHeight: 44)
        card(device.name, "\(device.platform) · \(status(device))", computerSymbol(device), actionable: false)
        if device.offline {
            Label(word("在这台电脑上打开 xopc 并检查网络连接。", "Open xopc on this computer and check its connection."), systemImage: "wifi.slash")
                .font(.subheadline).foregroundStyle(theme.secondary).padding(12)
                .background(theme.panel, in: .rect(cornerRadius: theme.corner(14)))
        } else {
            Text(word("本地文件", "Local files")).font(.subheadline.weight(.semibold))
            folderPermissions(device)
            if device.platform == "darwin" || device.platform == "win32" {
                Text(word("电脑控制", "Computer use")).font(.subheadline.weight(.semibold))
                card(word("操作应用窗口", "Operate application windows"), word("在电脑的设置中授权", "Authorize in settings on the computer"),
                     "macwindow", actionable: false)
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

    private func folderPermissions(_ device: ConnectedDevice) -> some View {
        VStack(spacing: 10) {
            let presets = [("desktop", word("桌面", "Desktop"), "desktopcomputer"),
                           ("documents", word("文稿", "Documents"), "doc.text"),
                           ("downloads", word("下载", "Downloads"), "arrow.down.to.line")]
            ForEach(presets, id: \.0) { kind, title, symbol in
                card(title, device.folders.contains { $0.kind == kind } ? word("已授权 · 只读", "Authorized · Read-only")
                    : word("需在电脑上授权", "Authorize on computer"), symbol, actionable: false)
            }
            ForEach(device.folders.filter { $0.kind == "custom" }) { folder in
                card(folder.label, word("已授权 · 只读", "Authorized · Read-only"), "folder", actionable: false)
            }
        }
    }

    private func status(_ device: ConnectedDevice) -> String {
        device.offline ? word("离线", "Offline") : word("在线", "Online")
    }

    private func computerSymbol(_ device: ConnectedDevice) -> String {
        device.platform == "darwin" ? "laptopcomputer" : "desktopcomputer"
    }

    private func card(_ title: String, _ subtitle: String, _ symbol: String, actionable: Bool = true) -> some View {
        CapabilityCardLabel(title: title, description: subtitle, hoverEnabled: actionable) {
            CapabilityLogo(reference: nil, origin: configuration.baseURL, label: "", symbol: symbol)
        } trailing: {
            if actionable {
                Image(systemName: "chevron.right").font(.caption.weight(.semibold))
                    .foregroundStyle(theme.secondary).accessibilityHidden(true)
            }
        }
        .background(theme.panel, in: .rect(cornerRadius: theme.corner(18)))
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
