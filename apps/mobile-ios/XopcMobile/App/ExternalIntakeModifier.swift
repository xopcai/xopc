import SwiftUI

struct ExternalIntakeModifier: ViewModifier {
    let appState: AppState
    @Environment(\.scenePhase) private var scenePhase
    @State private var selection: ExternalIntakeBatch?
    @State private var errorMessage: String?

    func body(content: Content) -> some View {
        content
            .onOpenURL { url in
                guard url.isFileURL else { return }
                do { _ = try ExternalIntakeStore().capture([url]); refresh() }
                catch { errorMessage = error.localizedDescription }
            }
            .onAppear(perform: refresh)
            .onChange(of: scenePhase) { if scenePhase == .active { refresh() } }
            .onChange(of: appState.gatewayConfiguration) { refresh() }
            .onChange(of: appState.externalIntakeRevision) { refresh() }
            .sheet(item: $selection) { batch in
                ExternalIntakeSheet(batch: batch, configuration: appState.gatewayConfiguration,
                    current: appState.selectedConversation, importError: appState.externalIntakeError,
                    onSelect: { batch, conversation in
                        appState.openExternalIntake(batch, conversation: conversation)
                        selection = nil
                    }, onCancel: {
                        do { try ExternalIntakeStore().remove(batch.id); selection = nil; refresh() }
                        catch { errorMessage = error.localizedDescription }
                    })
            }
            .alert("无法添加文件", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
                Button("关闭", role: .cancel) { errorMessage = nil }
            } message: { Text(errorMessage ?? "") }
    }

    private func refresh() {
        guard !appState.gatewayConfiguration.token.isEmpty, appState.externalIntake == nil else { return }
        do { selection = try ExternalIntakeStore().pending().first }
        catch { errorMessage = error.localizedDescription }
    }
}
