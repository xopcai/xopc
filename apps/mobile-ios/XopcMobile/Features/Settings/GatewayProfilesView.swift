import SwiftUI

struct GatewayProfilesView: View {
    let profiles: [GatewayProfile]
    let configurations: [String: GatewayConfiguration]
    let activeProfileID: String?
    let storageError: String?
    let onSave: (String, URL, String) -> Void
    let onActivate: (String) -> Void
    let onRename: (String, String) -> Void
    let onRemove: (String) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var probeStates: [String: GatewayProbeState] = [:]
    @State private var editing = false
    @State private var deleteProfile: GatewayProfile?
    @State private var renameProfile: GatewayProfile?
    @State private var renameText = ""

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(profiles) { profile in
                        GatewayProfileRow(
                            profile: profile,
                            isActive: profile.id == activeProfileID,
                            probe: probeStates[profile.id],
                            onProbe: { Task { _ = await probe(profile) } },
                            onActivate: {
                                Task {
                                    if await probe(profile) {
                                        onActivate(profile.id)
                                    }
                                }
                            },
                            onRename: {
                                renameText = profile.name
                                renameProfile = profile
                            },
                            onRemove: { deleteProfile = profile }
                        )
                    }
                } header: {
                    Text("已保存的 Gateway")
                } footer: {
                    Text("切换前必须先探测成功。令牌分别保存在系统钥匙串中。")
                }
                if let storageError {
                    Section { Label(storageError, systemImage: "exclamationmark.triangle").foregroundStyle(.red) }
                }
            }
            .navigationTitle("Gateway 管理")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("完成") { dismiss() } }
                ToolbarItemGroup(placement: .topBarTrailing) {
                    Button("全部探测", systemImage: "arrow.clockwise") { Task { await probeAll() } }
                    Button("添加", systemImage: "plus") { editing = true }
                }
            }
            .sheet(isPresented: $editing) {
                GatewayProfileEditor(existingProfiles: profiles, onSave: onSave)
            }
            .confirmationDialog(
                "移除 Gateway？",
                isPresented: Binding(get: { deleteProfile != nil }, set: {
                    if !$0 {
                        deleteProfile = nil
                    }
                }),
                titleVisibility: .visible
            ) {
                Button("移除", role: .destructive) {
                    if let deleteProfile {
                        onRemove(deleteProfile.id)
                    }
                    deleteProfile = nil
                }
                Button("取消", role: .cancel) { deleteProfile = nil }
            }
            .alert("重命名 Gateway", isPresented: Binding(get: { renameProfile != nil }, set: {
                if !$0 {
                    renameProfile = nil
                }
            })) {
                TextField("名称", text: $renameText)
                Button("取消", role: .cancel) { renameProfile = nil }
                Button("保存") {
                    if let renameProfile {
                        onRename(renameProfile.id, renameText)
                    }
                    renameProfile = nil
                }
                .disabled(renameText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
            .task { await probeAll() }
            .onChange(of: profiles) { Task { await probeAll() } }
        }
    }

    @MainActor private func probeAll() async {
        for profile in profiles {
            probeStates[profile.id] = .checking
        }
        await withTaskGroup(of: (String, GatewayProbeState).self) { group in
            for profile in profiles {
                group.addTask {
                    let started = ContinuousClock.now
                    let configuration = configurations[profile.id]
                        ?? GatewayConfiguration(baseURL: profile.baseURL, token: "")
                    do {
                        _ = try await GatewayClient(configuration: configuration).fetchAgents()
                        let elapsed = started.duration(to: .now)
                        return (profile.id, .reachable(milliseconds: elapsed.milliseconds, checkedAt: .now))
                    } catch {
                        return (profile.id, .offline(error.localizedDescription, checkedAt: .now))
                    }
                }
            }
            for await (id, state) in group {
                probeStates[id] = state
            }
        }
    }

    @MainActor private func probe(_ profile: GatewayProfile) async -> Bool {
        probeStates[profile.id] = .checking
        let configuration = configurations[profile.id]
            ?? GatewayConfiguration(baseURL: profile.baseURL, token: "")
        let started = ContinuousClock.now
        do {
            _ = try await GatewayClient(configuration: configuration).fetchAgents()
            let elapsed = started.duration(to: .now)
            probeStates[profile.id] = .reachable(milliseconds: elapsed.milliseconds, checkedAt: .now)
            return true
        } catch {
            probeStates[profile.id] = .offline(error.localizedDescription, checkedAt: .now)
            return false
        }
    }
}

private extension Duration {
    var milliseconds: Int {
        Int(components.seconds * 1000) + Int(components.attoseconds / 1_000_000_000_000_000)
    }
}

enum GatewayProbeState: Equatable {
    case checking
    case online(milliseconds: Int, checkedAt: Date)
    case warning(milliseconds: Int, checkedAt: Date)
    case offline(String, checkedAt: Date)

    static func reachable(milliseconds: Int, checkedAt: Date) -> GatewayProbeState {
        milliseconds >= 1500
            ? .warning(milliseconds: milliseconds, checkedAt: checkedAt)
            : .online(milliseconds: milliseconds, checkedAt: checkedAt)
    }

    var isOnline: Bool {
        switch self {
        case .online, .warning: true
        case .checking, .offline: false
        }
    }

    var checkedAt: Date? {
        switch self {
        case .checking: nil
        case let .online(_, checkedAt), let .warning(_, checkedAt), let .offline(_, checkedAt): checkedAt
        }
    }
}

private struct GatewayProfileRow: View {
    let profile: GatewayProfile
    let isActive: Bool
    let probe: GatewayProbeState?
    let onProbe: () -> Void
    let onActivate: () -> Void
    let onRename: () -> Void
    let onRemove: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                VStack(alignment: .leading, spacing: 3) {
                    Text(profile.name).font(.headline)
                    Text(profile.baseURL.absoluteString).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer()
                if isActive {
                    Text("当前").font(.caption.weight(.semibold)).foregroundStyle(.blue)
                }
            }
            HStack {
                ProbeLabel(state: probe)
                Spacer()
                NavigationLink("详情") {
                    GatewayProfileDetailView(
                        profile: profile,
                        isActive: isActive,
                        probe: probe,
                        onProbe: onProbe,
                        onRename: onRename
                    )
                }
                Button("探测", action: onProbe)
                if !isActive {
                    Button("切换", action: onActivate).disabled(probe?.isOnline != true)
                    Button("移除", role: .destructive, action: onRemove)
                }
            }
            .font(.caption)
        }
        .padding(.vertical, 4)
    }
}

private struct GatewayProfileDetailView: View {
    let profile: GatewayProfile
    let isActive: Bool
    let probe: GatewayProbeState?
    let onProbe: () -> Void
    let onRename: () -> Void

    var body: some View {
        List {
            Section("Gateway") {
                LabeledContent("名称", value: profile.name)
                LabeledContent("地址", value: profile.baseURL.absoluteString)
                LabeledContent("使用状态", value: isActive ? "当前使用" : "未使用")
                Button("重命名", systemImage: "pencil", action: onRename)
            }
            Section("连接") {
                ProbeLabel(state: probe)
                if let checkedAt = probe?.checkedAt {
                    LabeledContent("上次检查") {
                        Text(checkedAt, format: .dateTime.month().day().hour().minute().second())
                    }
                }
                Button("重新探测", systemImage: "arrow.clockwise", action: onProbe)
            }
            Section {
                Label("访问令牌保存在系统钥匙串中，不在页面中回显。", systemImage: "lock.shield")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .navigationTitle("Gateway 详情")
        .navigationBarTitleDisplayMode(.inline)
    }
}

private struct ProbeLabel: View {
    let state: GatewayProbeState?

    var body: some View {
        switch state {
        case .none, .some(.checking): Label("探测中", systemImage: "circle.dotted").foregroundStyle(.secondary)
        case let .some(.online(milliseconds, _)):
            Label("在线 · \(milliseconds) ms", systemImage: "checkmark.circle.fill").foregroundStyle(.green)
        case let .some(.warning(milliseconds, _)):
            Label("高延迟 · \(milliseconds) ms", systemImage: "exclamationmark.triangle.fill").foregroundStyle(.orange)
        case let .some(.offline(message, _)):
            Label("离线", systemImage: "xmark.circle.fill").foregroundStyle(.red).accessibilityHint(message)
        }
    }
}

private struct GatewayProfileEditor: View {
    let existingProfiles: [GatewayProfile]
    let onSave: (String, URL, String) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var baseURL = ""
    @State private var token = ""
    @State private var isTesting = false
    @State private var result: String?

    var body: some View {
        NavigationStack {
            Form {
                TextField("名称", text: $name)
                TextField("地址", text: $baseURL).textInputAutocapitalization(.never).keyboardType(.URL).autocorrectionDisabled()
                SecureField("访问令牌", text: $token).textInputAutocapitalization(.never).autocorrectionDisabled()
                Button("测试连接") { Task { await test() } }.disabled(validatedURL == nil || isTesting)
                if let result {
                    Text(result).font(.footnote)
                }
            }
            .navigationTitle("添加 Gateway")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("保存") {
                        guard let url = validatedURL else { return }
                        onSave(name.isEmpty ? (url.host ?? "Gateway") : name, url, token)
                        dismiss()
                    }
                    .disabled(validatedURL == nil || isDuplicate || name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
    }

    private var isDuplicate: Bool {
        guard let validatedURL else { return false }
        return existingProfiles.contains { $0.baseURL == validatedURL }
    }

    private var validatedURL: URL? {
        guard let url = URL(string: baseURL.trimmingCharacters(in: .whitespacesAndNewlines)),
              let scheme = url.scheme?.lowercased(), ["http", "https"].contains(scheme), url.host != nil
        else { return nil }
        return url
    }

    @MainActor private func test() async {
        guard let url = validatedURL else { return }
        isTesting = true
        defer { isTesting = false }
        do {
            let count = try await GatewayClient(configuration: GatewayConfiguration(baseURL: url, token: token)).fetchAgents().agents.count
            result = AppLocalization.resolve("连接成功，读取到 \(count) 个助手")
        } catch { result = error.localizedDescription }
    }
}
