// swiftlint:disable file_length
import AVFoundation
import SwiftUI

struct GatewayProfilesView: View {
    let profiles: [GatewayProfile]
    let activeProfileID: String?
    let storageError: String?
    let onPair: (String, @escaping @MainActor (String) -> Void) async throws -> Void
    let onRefresh: (String) async throws -> GatewayConfiguration
    let onActivate: (String) -> Void
    let onRename: (String, String) -> Void
    let onRemove: (String) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var probeStates: [String: GatewayProbeState] = [:]
    @State private var editing = false
    @State private var deleteProfile: GatewayProfile?
    @State private var detailProfile: GatewayProfile?
    @State private var renameProfile: GatewayProfile?
    @State private var renameText = ""

    var body: some View {
        NavigationStack {
            List {
                Section {
                    if profiles.isEmpty {
                        ContentUnavailableView {
                            Label("还没有连接 Gateway", systemImage: "network")
                        } description: {
                            Text("在电脑上生成连接二维码后，点右上角添加。")
                        }
                    } else {
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
                                onDetails: { detailProfile = profile },
                                onRemove: { deleteProfile = profile }
                            )
                        }
                    }
                } header: {
                    Text("已保存的 Gateway")
                } footer: {
                    Text("切换前必须先探测成功。连接凭据分别保存在系统钥匙串中。")
                }
                if let storageError {
                    Section { Label(storageError, systemImage: "exclamationmark.triangle").foregroundStyle(.red) }
                }
            }
            .navigationTitle("Gateway 管理")
            .navigationBarTitleDisplayMode(.inline)
            .navigationDestination(item: $detailProfile) { profile in
                GatewayProfileDetailView(
                    profile: profile,
                    isActive: profile.id == activeProfileID,
                    probe: probeStates[profile.id],
                    onProbe: { Task { _ = await probe(profile) } },
                    onRename: {
                        renameText = profile.name
                        renameProfile = profile
                    }
                )
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("完成") { dismiss() } }
                ToolbarItemGroup(placement: .topBarTrailing) {
                    Button("全部探测", systemImage: "arrow.clockwise") { Task { await probeAll() } }
                    Button("添加", systemImage: "plus") { editing = true }
                }
            }
            .sheet(isPresented: $editing) {
                GatewayProfileEditor(onPair: onPair)
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
            } message: {
                Text("将从此设备移除连接凭据。若移除当前 Gateway，会切换到其他已保存的 Gateway。")
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
            .onChange(of: profiles.map(\.id)) { Task { await probeAll() } }
        }
    }

    @MainActor private func probeAll() async {
        for profile in profiles {
            probeStates[profile.id] = .checking
        }
        for profile in profiles {
            _ = await probe(profile)
        }
    }

    @MainActor private func probe(_ profile: GatewayProfile) async -> Bool {
        probeStates[profile.id] = .checking
        let started = ContinuousClock.now
        do {
            let configuration = try await onRefresh(profile.id)
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
    let onDetails: () -> Void
    let onRemove: () -> Void
    @State private var expanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Button {
                withAnimation(.easeInOut(duration: 0.2)) { expanded.toggle() }
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: "link")
                        .font(.title3)
                        .foregroundStyle(.blue)
                        .frame(width: 44, height: 44)
                        .background(.blue.opacity(0.1), in: .rect(cornerRadius: 14))
                    VStack(alignment: .leading, spacing: 4) {
                        Text(profile.name).font(.headline).foregroundStyle(.primary)
                        Text(profile.baseURL.host ?? profile.baseURL.absoluteString)
                            .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    }
                    Spacer(minLength: 6)
                    if isActive {
                        Text("当前")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.blue)
                    }
                    Image(systemName: expanded ? "chevron.up" : "chevron.down")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.tertiary)
                }
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("gateway-profile-\(profile.id)")
            HStack {
                ProbeLabel(state: probe)
                Spacer()
                Button("探测", action: onProbe)
            }
            .font(.caption)
            if expanded {
                Divider()
                Text(profile.baseURL.absoluteString)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
                HStack(spacing: 12) {
                    Button("详情", action: onDetails)
                    Button("重命名", action: onRename)
                    Spacer()
                    Button("移除", role: .destructive, action: onRemove)
                }
                .font(.subheadline)
                if !isActive {
                    Button("切换", action: onActivate)
                        .font(.subheadline)
                        .disabled(probe?.isOnline != true)
                }
            }
        }
        .padding(.vertical, 8)
        .buttonStyle(.borderless)
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
                LabeledContent("使用状态") {
                    Text(isActive
                        ? LocalizedStringResource("当前使用")
                        : LocalizedStringResource("未使用"))
                }
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
                Label("连接凭据保存在系统钥匙串中，不会在页面显示。", systemImage: "lock.shield")
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

struct GatewayProfileEditor: View {
    let onPair: (String, @escaping @MainActor (String) -> Void) async throws -> Void
    let canCancel: Bool
    let onManage: (() -> Void)?

    @Environment(\.dismiss) private var dismiss
    @State private var link = ""
    @State private var showingScanner = false
    @State private var showingManualEntry = false
    @State private var isPairing = false
    @State private var confirmationCode = ""
    @State private var errorMessage: String?
    @State private var pairingTask: Task<Void, Never>?

    init(
        onPair: @escaping (String, @escaping @MainActor (String) -> Void) async throws -> Void,
        canCancel: Bool = true,
        onManage: (() -> Void)? = nil
    ) {
        self.onPair = onPair
        self.canCancel = canCancel
        self.onManage = onManage
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    Text(isPairing ? "等待电脑确认" : "连接你的 Gateway")
                        .font(.largeTitle.bold())
                    Text(isPairing
                        ? "请在电脑上核对并批准这台 iPhone 的连接请求。"
                        : "在电脑的 xopc 中打开设备配对，扫描二维码即可连接。")
                        .foregroundStyle(.secondary)

                    if !confirmationCode.isEmpty {
                        VStack(spacing: 10) {
                            Text(confirmationCode)
                                .font(.system(size: 40, weight: .semibold, design: .rounded))
                                .tracking(5)
                            Text("确认电脑上显示相同的核对码后批准连接。")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(24)
                        .background(Color.secondary.opacity(0.1), in: .rect(cornerRadius: 18))
                    }

                    if let errorMessage {
                        Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                            .font(.footnote)
                            .foregroundStyle(.red)
                    }

                    if isPairing {
                        ProgressView("正在等待批准…")
                            .frame(maxWidth: .infinity)
                    } else if showingManualEntry {
                        TextField("粘贴电脑生成的连接链接", text: $link, axis: .vertical)
                            .lineLimit(3 ... 5)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .padding(14)
                            .background(Color.secondary.opacity(0.1), in: .rect(cornerRadius: 14))
                            .accessibilityIdentifier("gateway-pairing-link")
                        Button("连接 Gateway") { connect() }
                            .buttonStyle(.borderedProminent)
                            .frame(maxWidth: .infinity)
                            .disabled(link.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        Button("返回扫码") { showingManualEntry = false }
                            .frame(maxWidth: .infinity)
                    } else {
                        Button {
                            showingScanner = true
                        } label: {
                            Label("扫描连接二维码", systemImage: "qrcode.viewfinder")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                        .accessibilityIdentifier("gateway-pairing-scan")
                        Button("粘贴连接链接") { showingManualEntry = true }
                            .frame(maxWidth: .infinity)
                    }
                }
                .padding(24)
            }
            .navigationTitle(canCancel ? "添加 Gateway" : "连接 Gateway")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if canCancel {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("取消") {
                            pairingTask?.cancel()
                            Task { try? await GatewayPairingService.shared.cancelPending() }
                            dismiss()
                        }
                    }
                } else if let onManage {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Gateway 管理", systemImage: "gearshape", action: onManage)
                    }
                }
            }
            .interactiveDismissDisabled(isPairing)
            .onDisappear { pairingTask?.cancel() }
            .task {
                if let pending = GatewayPairingService.shared.pendingLink() {
                    link = pending
                    showingManualEntry = true
                }
            }
            .sheet(isPresented: $showingScanner) {
                NavigationStack {
                    GatewayQRScanner { value in
                        showingScanner = false
                        link = value
                        connect()
                    }
                    .navigationTitle("扫描连接二维码")
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("取消") { showingScanner = false }
                        }
                    }
                }
            }
        }
    }

    private func connect() {
        guard !isPairing else { return }
        isPairing = true
        errorMessage = nil
        confirmationCode = ""
        pairingTask = Task {
            do {
                try await onPair(link) { confirmationCode = $0 }
                try Task.checkCancellation()
                dismiss()
            } catch is CancellationError {
            } catch {
                errorMessage = error.localizedDescription
            }
            isPairing = false
            pairingTask = nil
        }
    }
}

private struct GatewayQRScanner: UIViewControllerRepresentable {
    let onScan: (String) -> Void

    func makeUIViewController(context _: Context) -> ScannerController {
        let controller = ScannerController()
        controller.onScan = onScan
        return controller
    }

    func updateUIViewController(_: ScannerController, context _: Context) {}

    final class ScannerController: UIViewController, @preconcurrency AVCaptureMetadataOutputObjectsDelegate {
        var onScan: ((String) -> Void)?
        private nonisolated(unsafe) let session = AVCaptureSession()
        private var didScan = false

        override func viewDidLoad() {
            super.viewDidLoad()
            view.backgroundColor = .black
            Task { @MainActor in
                let permission = await AVCaptureDevice.requestAccess(for: .video)
                guard permission, let camera = AVCaptureDevice.default(for: .video),
                      let input = try? AVCaptureDeviceInput(device: camera),
                      session.canAddInput(input)
                else {
                    let message = UILabel()
                    message.text = AppLocalization.string(
                        permission
                            ? "当前设备没有可用相机，请返回后粘贴连接链接。"
                            : "请允许相机访问，或返回后粘贴连接链接。",
                        locale: AppLocalization.selectedLocale
                    )
                    message.textColor = .white
                    message.textAlignment = .center
                    message.numberOfLines = 0
                    message.translatesAutoresizingMaskIntoConstraints = false
                    view.addSubview(message)
                    NSLayoutConstraint.activate([
                        message.centerXAnchor.constraint(equalTo: view.centerXAnchor),
                        message.centerYAnchor.constraint(equalTo: view.centerYAnchor),
                        message.leadingAnchor.constraint(greaterThanOrEqualTo: view.leadingAnchor, constant: 24),
                        message.trailingAnchor.constraint(lessThanOrEqualTo: view.trailingAnchor, constant: -24)
                    ])
                    return
                }
                session.addInput(input)
                let output = AVCaptureMetadataOutput()
                guard session.canAddOutput(output) else { return }
                session.addOutput(output)
                output.setMetadataObjectsDelegate(self, queue: .main)
                output.metadataObjectTypes = [.qr]
                let preview = AVCaptureVideoPreviewLayer(session: session)
                preview.videoGravity = .resizeAspectFill
                preview.frame = view.bounds
                view.layer.addSublayer(preview)
                DispatchQueue.global(qos: .userInitiated).async { self.session.startRunning() }
            }
        }

        override func viewDidLayoutSubviews() {
            super.viewDidLayoutSubviews()
            (view.layer.sublayers?.first as? AVCaptureVideoPreviewLayer)?.frame = view.bounds
        }

        override func viewWillDisappear(_ animated: Bool) {
            super.viewWillDisappear(animated)
            DispatchQueue.global(qos: .userInitiated).async { self.session.stopRunning() }
        }

        func metadataOutput(
            _: AVCaptureMetadataOutput, didOutput metadataObjects: [AVMetadataObject], from _: AVCaptureConnection
        ) {
            guard !didScan,
                  let value = (metadataObjects.first as? AVMetadataMachineReadableCodeObject)?.stringValue
            else { return }
            didScan = true
            onScan?(value)
        }
    }
}
