import SwiftUI

struct SaveFileVersionControl: View {
    let configuration: GatewayConfiguration
    let file: FileResource
    let revision: String

    @State private var pendingID: UUID?
    @State private var saving = false
    @State private var feedback: Bool?

    var body: some View {
        if file.kind == "file", (0 ... 8 * 1024 * 1024).contains(file.size),
           !revision.isEmpty, file.capabilities.contains("save_version")
        {
            HStack {
                Button("保存为新版本", action: save)
                    .frame(minHeight: 44)
                    .disabled(saving)
                    .accessibilityIdentifier("file-save-version")
                if saving {
                    ProgressView()
                }
                Spacer()
                if let feedback {
                    Text(feedback ? LocalizedStringResource("已保存新版本") : LocalizedStringResource("无法保存新版本"))
                        .font(.footnote)
                        .foregroundStyle(feedback ? Color.secondary : .red)
                }
            }
            .padding(.horizontal, 16)
            .background(.regularMaterial)
            .onChange(of: revision) { pendingID = nil; feedback = nil }
        }
    }

    private func save() {
        guard !saving else { return }
        let requestID = pendingID ?? UUID()
        pendingID = requestID
        saving = true
        feedback = nil
        Task {
            defer { saving = false }
            do {
                try await GatewayClient(configuration: configuration).saveFileVersion(
                    id: file.id, revision: revision, requestID: requestID
                )
                guard pendingID == requestID else { return }
                pendingID = nil
                feedback = true
            } catch is CancellationError {
            } catch {
                if pendingID == requestID {
                    feedback = false
                }
            }
        }
    }
}
