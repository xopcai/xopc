import SwiftUI

struct ConnectionSettingsView: View {
    let configuration: GatewayConfiguration
    let onSave: (URL, String) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var baseURLText: String
    @State private var token: String
    @State private var isTesting = false
    @State private var connectionResult: ConnectionTestResult?

    init(
        configuration: GatewayConfiguration,
        onSave: @escaping (URL, String) -> Void
    ) {
        self.configuration = configuration
        self.onSave = onSave
        _baseURLText = State(initialValue: configuration.baseURL.absoluteString)
        _token = State(initialValue: configuration.token)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("地址", text: $baseURLText)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.URL)
                        .autocorrectionDisabled()
                    SecureField("访问令牌", text: $token)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                } header: {
                    Text("Gateway")
                } footer: {
                    Text("访问令牌保存在系统钥匙串中，不会写入普通偏好设置。")
                }
                Section {
                    Button {
                        testConnection()
                    } label: {
                        HStack {
                            Text("测试连接")
                            Spacer()
                            if isTesting {
                                ProgressView()
                            }
                        }
                    }
                    .disabled(validatedURL == nil || isTesting)

                    if let connectionResult {
                        Label(connectionResult.message, systemImage: connectionResult.symbol)
                            .foregroundStyle(connectionResult.color)
                    }
                }
            }
            .navigationTitle("连接设置")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("保存") { save() }
                        .disabled(validatedURL == nil)
                }
            }
        }
    }

    private var validatedURL: URL? {
        guard let url = URL(string: baseURLText.trimmingCharacters(in: .whitespacesAndNewlines)),
              let scheme = url.scheme?.lowercased(),
              ["http", "https"].contains(scheme),
              url.host != nil
        else {
            return nil
        }
        return url
    }

    private func save() {
        guard let url = validatedURL else { return }
        onSave(url, token)
        dismiss()
    }

    private func testConnection() {
        guard let url = validatedURL else { return }
        isTesting = true
        connectionResult = nil
        let configuration = GatewayConfiguration(
            baseURL: url,
            token: token.trimmingCharacters(in: .whitespacesAndNewlines)
        )
        Task {
            do {
                let catalog = try await GatewayClient(configuration: configuration).fetchAgents()
                connectionResult = .success(AppLocalization.resolve("连接成功，已读取 \(catalog.agents.count) 个助手"))
            } catch {
                connectionResult = .failure(error.localizedDescription)
            }
            isTesting = false
        }
    }
}

private struct ConnectionTestResult {
    let message: String
    let isSuccessful: Bool

    static func success(_ message: String) -> ConnectionTestResult {
        ConnectionTestResult(message: message, isSuccessful: true)
    }

    static func failure(_ message: String) -> ConnectionTestResult {
        ConnectionTestResult(message: message, isSuccessful: false)
    }

    var symbol: String {
        isSuccessful ? "checkmark.circle.fill" : "xmark.circle.fill"
    }

    var color: Color {
        isSuccessful ? .green : .red
    }
}
