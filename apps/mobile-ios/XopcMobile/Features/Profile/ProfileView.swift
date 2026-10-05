import SwiftUI

struct ProfileView: View {
    let configuration: GatewayConfiguration
    let onOpenGatewaySettings: () -> Void

    @Environment(\.locale) private var locale

    @State private var summary: MobileUserSummary?
    @State private var error: String?

    var body: some View {
        List {
            if let summary {
                Section {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(summary.profile.callName ?? summary.suggestedCallName ?? "xopc 用户")
                            .font(.title2.bold())
                        if let role = summary.profile.role, !role.isEmpty {
                            Text(role).foregroundStyle(.secondary)
                        }
                    }
                    .padding(.vertical, 8)
                    .accessibilityElement(children: .combine)
                }
                Section("个人理解") {
                    LabeledContent("记忆总数", value: "\(summary.counts.total)")
                    LabeledContent("明确提供", value: "\(summary.counts.explicit)")
                    LabeledContent("逐渐学到", value: "\(summary.counts.learned)")
                    LabeledContent("待确认", value: "\(summary.counts.review)")
                    NavigationLink("查看个人理解") { UserUnderstandingView(summary: summary) }
                }
            } else if let error {
                Section { Label(error, systemImage: "exclamationmark.triangle").foregroundStyle(.red) }
            } else {
                Section { ProfileSkeleton() }
            }

            Section("内容") {
                NavigationLink {
                    FilesView(configuration: configuration)
                } label: {
                    Label("文件", systemImage: "folder")
                }
            }

            Section("设置") {
                Button("Gateway 管理", systemImage: "network") { onOpenGatewaySettings() }
                NavigationLink {
                    AppSettingsView()
                } label: {
                    Label("应用设置", systemImage: "gearshape")
                }
                NavigationLink {
                    AboutView()
                } label: {
                    Label("关于 xopc", systemImage: "info.circle")
                }
            }
        }
        .navigationTitle(AppLocalization.string("我的", locale: locale))
        .refreshable { await load() }
        .task { await load() }
    }

    @MainActor private func load() async {
        do { summary = try await GatewayClient(configuration: configuration).fetchMobileUserSummary(); error = nil }
        catch is CancellationError {} catch { self.error = error.localizedDescription }
    }
}

private struct UserUnderstandingView: View {
    let summary: MobileUserSummary

    var body: some View {
        List {
            if !summary.goals.isEmpty {
                Section("目标") {
                    ForEach(summary.goals) { goal in
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text(goal.title).font(.headline); if goal.isPrimary == true {
                                    Text("主要").font(.caption).foregroundStyle(.blue)
                                }
                            }
                            if let outcome = goal.desiredOutcome {
                                Text(outcome).font(.subheadline).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
            Section("最近理解") {
                if summary.recent.isEmpty {
                    Text("暂无记录").foregroundStyle(.secondary)
                } else {
                    ForEach(summary.recent) { assertion in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(assertion.statement)
                            HStack { Text(assertion.kind); Text(assertion.status) }.font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
            }
            Section("隐私") {
                LabeledContent("记忆") {
                    Text(summary.settings.memoryEnabled
                        ? LocalizedStringResource("已开启")
                        : LocalizedStringResource("已关闭"))
                }
                LabeledContent("显示记忆引用") {
                    Text(summary.settings.showMemoryReferences
                        ? LocalizedStringResource("是")
                        : LocalizedStringResource("否"))
                }
                LabeledContent("敏感写入策略", value: summary.settings.sensitiveWritePolicy)
            }
        }
        .navigationTitle("个人理解")
        .navigationBarTitleDisplayMode(.inline)
    }
}

private struct ProfileSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 8) { Text("用户名称").font(.title2); Text("正在读取个人理解") }
            .redacted(reason: .placeholder)
    }
}

private struct AboutView: View {
    var body: some View {
        List {
            LabeledContent("应用", value: "xopc")
            LabeledContent("客户端", value: "原生 iOS")
            LabeledContent("最低系统", value: "iOS 17")
        }
        .navigationTitle("关于 xopc")
    }
}
