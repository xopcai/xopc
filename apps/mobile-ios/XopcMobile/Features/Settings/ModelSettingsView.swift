import SwiftUI

private struct GlobalModelChoice: Decodable, Identifiable {
    let ref: String
    let name: String
    let provider: String
    let displayNames: [String: String]?
    var id: String {
        ref
    }

    func localizedName(_ locale: Locale) -> String {
        displayNames?[locale.language.languageCode?.identifier == "zh" ? "zh-CN" : "en"] ?? name
    }
}

private struct GlobalModelRoute: Decodable, Identifiable {
    let key: String
    let pool: String
    let ref: String?
    let name: String?
    let inherited: Bool?
    let allowInherit: Bool?
    var id: String {
        key
    }
}

private struct GlobalModelSettings: Decodable {
    let revision: String
    let routing: [GlobalModelRoute]
    let tasks: [GlobalModelRoute]
    let fallbacks: [GlobalModelChoice]
    let pools: [String: [GlobalModelChoice]]
}

private enum GlobalModelChange: Encodable {
    case model(String, String?)
    case task(String, String?)
    case fallbacks([String])

    private enum CodingKeys: String, CodingKey { case kind, key, ref, refs }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case let .fallbacks(refs):
            try container.encode("fallbacks", forKey: .kind)
            try container.encode(refs, forKey: .refs)
        case let .model(key, ref), let .task(key, ref):
            if case .model = self {
                try container.encode("model", forKey: .kind)
            } else {
                try container.encode("task", forKey: .kind)
            }
            try container.encode(key, forKey: .key)
            try container.encode(ref, forKey: .ref)
        }
    }
}

// swiftlint:disable:next type_body_length
struct ModelSettingsView: View {
    private enum Scope: String { case model, task }
    private enum Sheet: Identifiable {
        case fallbacks, addFallback, choose(GlobalModelRoute, Scope)

        var id: String {
            switch self {
            case .fallbacks: "fallbacks"
            case .addFallback: "add-fallback"
            case let .choose(route, scope): "\(scope.rawValue)-\(route.key)"
            }
        }
    }

    let configuration: GatewayConfiguration
    private let path = "/api/mobile/model-settings"
    @State private var data: GlobalModelSettings?
    @State private var sheet: Sheet?
    @State private var saving = false
    @State private var loading = false
    @State private var error: LocalizedStringKey?
    @State private var sheetError = false
    @State private var selected: String?
    @State private var query = ""
    @Environment(\.mobileTheme) private var theme
    @Environment(\.locale) private var locale

    var body: some View {
        List {
            if let error {
                Section {
                    Text(error).foregroundStyle(.secondary)
                    if data == nil {
                        Button("重试") { Task { await load() } }
                    }
                }
            }
            if loading {
                ProgressView()
            }
            if let data {
                modelSections(data)
            }
        }
        .listSectionSpacing(16)
        .mobilePageTitle(Text("模型设置"))
        .task(id: configuration) { await load() }
        .refreshable { await load() }
        .sheet(item: $sheet) { sheet in
            if let data {
                sheetContent(sheet, data: data)
                    .presentationDetents(sheetDetents(sheet, data: data))
                    .presentationDragIndicator(.visible)
                    .interactiveDismissDisabled(saving)
            }
        }
    }

    @ViewBuilder private func modelSections(_ data: GlobalModelSettings) -> some View {
        Section("默认模型") {
            if let primary = data.routing.first(where: { $0.key == "chat" }) {
                routeRow(primary, data: data, scope: .model)
            }
            Button { open(.fallbacks) } label: {
                settingLabel("备用模型", symbol: "list.bullet", trailing: Text(data.fallbacks.count.formatted()))
            }.accessibilityIdentifier("model-settings-fallbacks")
        }
        if !data.tasks.isEmpty {
            Section("按任务选模型") {
                ForEach(data.tasks) { routeRow($0, data: data, scope: .task) }
            }
        }
        let other = data.routing.filter { ["background", "vision", "image"].contains($0.key) }
        if !other.isEmpty {
            Section("其他用途") {
                ForEach(other) { routeRow($0, data: data, scope: .model) }
            }
        }
        let media = data.routing.filter { !["chat", "background", "vision", "image"].contains($0.key) }
        if !media.isEmpty {
            Section("语音与更多媒体") {
                ForEach(media) { routeRow($0, data: data, scope: .model) }
            }
        }
    }

    private func routeRow(_ route: GlobalModelRoute, data: GlobalModelSettings, scope: Scope) -> some View {
        let value = if route.inherited == true {
            Text("继承默认")
        } else if route.key != "chat", data.pools[route.pool]?.isEmpty != false {
            Text("暂无可用模型")
        } else if let name = route.name {
            Text(verbatim: data.pools[route.pool]?.first { $0.ref == route.ref }?.localizedName(locale) ?? name)
        } else {
            Text("未配置")
        }
        return Button { open(.choose(route, scope), current: route.ref) } label: {
            settingLabel(label(route.key, scope: scope), symbol: routeSymbol(route.key), trailing: value)
        }
        .accessibilityIdentifier(scope == .task ? "model-task-\(route.key)" : "model-setting-\(route.key)")
    }

    private func settingLabel(_ title: LocalizedStringKey, symbol: String, trailing: Text) -> some View {
        HStack {
            Image(systemName: symbol)
                .foregroundStyle(.secondary)
                .frame(width: 24)
                .accessibilityHidden(true)
            Text(title).foregroundStyle(.primary)
            Spacer(minLength: 8)
            trailing.mobileTextStyle(.caption).foregroundStyle(.secondary)
            Image(systemName: "chevron.right").font(.caption2).foregroundStyle(.tertiary).accessibilityHidden(true)
        }.frame(minHeight: 44).contentShape(Rectangle())
    }

    // swiftlint:disable:next cyclomatic_complexity
    private func label(_ key: String, scope: Scope) -> LocalizedStringKey {
        switch key {
        case "chat": "对话与任务"
        case "background": "自动与后台任务"
        case "vision": scope == .task ? "视觉任务" : "看图"
        case "image": "生成图片"
        case "transcription": "录音与听写"
        case "speech": "文字转语音"
        case "conversation": "实时语音对话"
        case "video": "生成视频"
        case "music": "生成音乐"
        case "fast": "快速任务"
        case "reasoning": "复杂推理"
        case "coding": "编程"
        case "review": "审查"
        case "understanding": "内容理解"
        default: "模型设置"
        }
    }

    // swiftlint:disable:next cyclomatic_complexity
    private func routeSymbol(_ key: String) -> String {
        switch key {
        case "chat": "ellipsis.bubble"
        case "background": "clock"
        case "vision": "eye"
        case "image": "paintbrush"
        case "transcription": "mic"
        case "speech": "speaker.wave.2"
        case "conversation": "waveform"
        case "video": "film"
        case "music": "music.note"
        case "fast": "bolt"
        case "reasoning": "lightbulb"
        case "coding": "chevron.left.forwardslash.chevron.right"
        case "review": "checkmark.circle"
        case "understanding": "doc.text"
        default: "rectangle.stack"
        }
    }

    private func open(_ sheet: Sheet, current: String? = nil) {
        selected = current
        query = ""
        sheetError = false
        self.sheet = sheet
    }

    private func sheetContent(_ sheet: Sheet, data: GlobalModelSettings) -> some View {
        NavigationStack {
            List {
                if sheetError {
                    Text("无法保存模型设置，请重试。").foregroundStyle(.red)
                }
                switch sheet {
                case .fallbacks:
                    Section {
                        ForEach(Array(data.fallbacks.enumerated()), id: \.element.id) { index, choice in
                            HStack {
                                Text("\(index + 1). \(choice.localizedName(locale))")
                                Spacer()
                                Button("上移") {
                                    var refs = data.fallbacks.map(\.ref)
                                    refs.swapAt(index, index - 1)
                                    save(.fallbacks(refs), revision: data.revision)
                                }.disabled(index == 0)
                                Button("移除") {
                                    save(.fallbacks(data.fallbacks.filter { $0.ref != choice.ref }.map(\.ref)), revision: data.revision)
                                }.foregroundStyle(.red)
                            }.buttonStyle(.borderless)
                        }
                        Button("添加备用模型", systemImage: "plus") { open(.addFallback) }
                    } footer: { Text("默认模型失败时，按顺序尝试。") }
                case .addFallback:
                    picker(fallbackChoices(data), inherit: false)
                case let .choose(route, _):
                    picker(data.pools[route.pool, default: []], inherit: route.allowInherit == true)
                }
            }
            .disabled(saving)
            .navigationTitle(sheetTitle(sheet))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("关闭") { self.sheet = nil }.disabled(saving) }
            }
            .safeAreaInset(edge: .bottom) {
                if saving {
                    ProgressView().padding()
                } else {
                    confirmAction(sheet, data: data)
                }
            }
        }
    }

    private func fallbackChoices(_ data: GlobalModelSettings) -> [GlobalModelChoice] {
        let primary = data.routing.first { $0.key == "chat" }?.ref
        return data.pools["chat", default: []].filter { candidate in
            candidate.ref != primary && !data.fallbacks.contains { $0.ref == candidate.ref }
        }
    }

    private func sheetDetents(_ sheet: Sheet, data: GlobalModelSettings) -> Set<PresentationDetent> {
        let count = switch sheet {
        case .fallbacks: data.fallbacks.count
        case .addFallback: fallbackChoices(data).count
        case let .choose(route, _): data.pools[route.pool, default: []].count + (route.allowInherit == true ? 1 : 0)
        }
        if count == 0 {
            return [.height(250), .large]
        }
        if count <= 3 {
            return [.height(248 + CGFloat(count) * 42), .large]
        }
        return [.large]
    }

    private func sheetTitle(_ sheet: Sheet) -> Text {
        switch sheet {
        case .fallbacks: Text("备用模型")
        case .addFallback: Text("添加备用模型")
        case let .choose(route, scope): Text(label(route.key, scope: scope))
        }
    }

    @ViewBuilder private func picker(_ options: [GlobalModelChoice], inherit: Bool) -> some View {
        if !options.isEmpty {
            TextField("搜索模型或服务商", text: $query).accessibilityIdentifier("model-settings-search")
        }
        if inherit {
            choiceRow(Text("继承默认"), detail: nil, ref: nil)
        }
        let search = query.trimmingCharacters(in: .whitespacesAndNewlines)
        let matches = options.filter { choice in
            search.isEmpty || [choice.localizedName(locale), choice.name, choice.provider, choice.ref].contains {
                $0.localizedCaseInsensitiveContains(search)
            }
        }
        ForEach(matches) { choice in
            choiceRow(Text(verbatim: choice.localizedName(locale)), detail: choice.provider, ref: choice.ref)
        }
        if matches.isEmpty {
            Text(options.isEmpty ? "连接支持此用途的模型服务后再试。" : "没有匹配的模型").foregroundStyle(.secondary)
        }
    }

    private func choiceRow(_ name: Text, detail: String?, ref: String?) -> some View {
        Button { selected = ref } label: {
            HStack {
                VStack(alignment: .leading, spacing: 3) {
                    name.foregroundStyle(.primary)
                    if let detail {
                        Text(verbatim: detail).mobileTextStyle(.caption).foregroundStyle(.secondary)
                    }
                }
                Spacer()
                if selected == ref {
                    Image(systemName: "checkmark.circle.fill").foregroundStyle(theme.action)
                        .accessibilityHidden(true)
                }
            }.frame(minHeight: 44).contentShape(Rectangle())
        }
        .accessibilityIdentifier("model-choice-\(ref ?? "inherit")")
        .accessibilityAddTraits(selected == ref ? .isSelected : [])
    }

    @ViewBuilder private func confirmAction(_ sheet: Sheet, data: GlobalModelSettings) -> some View {
        switch sheet {
        case .fallbacks: EmptyView()
        case .addFallback:
            confirm("添加备用模型", enabled: selected != nil) {
                if let selected {
                    save(.fallbacks(data.fallbacks.map(\.ref) + [selected]), revision: data.revision, returnToFallbacks: true)
                }
            }
        case let .choose(route, scope):
            if route.allowInherit == true || data.pools[route.pool]?.isEmpty == false {
                confirm("确认更换", enabled: selected != route.ref) {
                    save(scope == .task ? .task(route.key, selected) : .model(route.key, selected), revision: data.revision, close: true)
                }
            }
        }
    }

    private func confirm(_ title: LocalizedStringKey, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) { Text(title).frame(maxWidth: .infinity).frame(minHeight: 42) }
            .buttonStyle(.borderedProminent).disabled(!enabled)
            .padding(.horizontal, 16).padding(.vertical, 8).background(.bar)
            .accessibilityIdentifier("model-settings-confirm")
    }

    @MainActor private func load(preserveMessage: Bool = false) async {
        guard !loading else { return }
        loading = true
        defer { loading = false }
        do {
            let envelope: GatewayEnvelope<GlobalModelSettings> = try await GatewayClient(configuration: configuration).request(path: path)
            guard let payload = envelope.payload else { throw GatewayClientError.invalidResponse }
            data = payload
            if !preserveMessage {
                error = nil
            }
        } catch is CancellationError {} catch GatewayClientError.http(statusCode: 404, message: _) {
            error = "请更新 Gateway 后再使用模型设置。"
        } catch { self.error = "无法读取模型设置。" }
    }

    @MainActor private func save(_ change: GlobalModelChange, revision: String, close: Bool = false, returnToFallbacks: Bool = false) {
        guard !saving else { return }
        saving = true
        sheetError = false
        Task {
            defer { saving = false }
            do {
                let raw = try JSONEncoder().encode(change)
                guard var body = try JSONSerialization.jsonObject(with: raw) as? [String: Any] else { throw GatewayClientError.invalidResponse }
                body["revision"] = revision
                let request = try JSONSerialization.data(withJSONObject: body)
                let envelope: GatewayEnvelope<GlobalModelSettings> = try await GatewayClient(configuration: configuration)
                    .request(path: path, method: "PATCH", body: request)
                guard let payload = envelope.payload else { throw GatewayClientError.invalidResponse }
                data = payload
                error = nil
                if close {
                    sheet = nil
                }
                if returnToFallbacks {
                    sheet = .fallbacks
                }
            } catch is CancellationError {} catch GatewayClientError.http(statusCode: 409, message: _) {
                sheet = nil
                data = nil
                error = "模型设置已变化，已重新读取。"
                await load(preserveMessage: true)
            } catch { sheetError = true }
        }
    }
}
