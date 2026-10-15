import SwiftUI

struct ClarificationCard: View {
    let clarification: ClarificationRequest
    let isSubmitting: Bool
    let errorMessage: String?
    let onRespond: (String, ClarificationSubmission?) -> Void

    @State private var draft = ""
    @State private var selectedID: String?
    @State private var editing = false

    private var trimmed: String {
        draft.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var compose: Bool {
        editing || clarification.interactionMode == "compose"
    }

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            let remaining = clarification.expiresAt.map { max(0, Int((Double($0) / 1000 - context.date.timeIntervalSince1970).rounded(.up))) }
            let disabled = isSubmitting || remaining == 0
            VStack(alignment: .leading, spacing: 12) {
                Label(AppLocalization.resolve(clarification.kind == "approval" ? "需要你的批准" : "助手需要补充信息"),
                      systemImage: clarification.kind == "approval" ? "checkmark.shield" : "questionmark.bubble")
                    .font(.headline)
                Text(clarification.question).textSelection(.enabled)
                if let remaining {
                    Text(remaining == 0 ? AppLocalization.resolve("此审批已过期") : String(format: AppLocalization.resolve("剩余时间：%d:%@"), remaining / 60, String(format: "%02d", remaining % 60)))
                        .font(.caption).foregroundStyle(.secondary)
                }
                if clarification.kind == "approval" {
                    if let approval = clarification.approval {
                        Text(approval.operation).font(.subheadline.weight(.medium))
                        if let target = approval.target {
                            Text(target).font(.subheadline)
                        }
                        if let impact = approval.impact {
                            Text(impact).font(.subheadline).foregroundStyle(.secondary)
                        }
                        if let preview = approval.preview {
                            DisclosureGroup("查看参数详情") { Text(preview).font(.caption.monospaced()).textSelection(.enabled) }
                        }
                    }
                    Text("授权仅适用于本次操作，且只能执行一次。").font(.caption).foregroundStyle(.secondary)
                    HStack {
                        Button("拒绝本次操作") { onRespond("answer", .approval("deny")) }.buttonStyle(.bordered)
                        Button("批准本次操作") { onRespond("answer", .approval("approve")) }.buttonStyle(.borderedProminent)
                    }.disabled(disabled)
                } else {
                    if clarification.choiceDetails?.isEmpty == false, !compose {
                        HStack {
                            Text("点击选项即可回答").font(.caption).foregroundStyle(.secondary)
                            Spacer()
                            Button("选择并补充") { editing = true }
                        }
                    }
                    ForEach(clarification.choiceDetails ?? []) { choice in
                        Button {
                            if compose || !draft.isEmpty {
                                editing = true; selectedID = choice.id
                            } else {
                                onRespond("answer", .input(choiceId: choice.id))
                            }
                        } label: {
                            HStack(alignment: .top) {
                                if selectedID == choice.id {
                                    Image(systemName: "checkmark.circle.fill")
                                }
                                VStack(alignment: .leading, spacing: 4) {
                                    HStack {
                                        Text(choice.label)
                                        if choice.id == clarification.recommendedChoiceId {
                                            Text("推荐").font(.caption).foregroundStyle(.blue)
                                        }
                                    }
                                    if let description = choice.description {
                                        Text(description).font(.caption).foregroundStyle(.secondary)
                                    }
                                }
                                Spacer(minLength: 0)
                            }.frame(maxWidth: .infinity, minHeight: 32, alignment: .leading)
                        }
                        .buttonStyle(.bordered)
                        .tint(selectedID == choice.id ? .blue : .secondary)
                        .accessibilityAddTraits(selectedID == choice.id ? .isSelected : [])
                        .disabled(disabled)
                    }
                    if selectedID != nil {
                        Button("清除选择") { selectedID = nil }.disabled(disabled)
                    }
                    Text(AppLocalization.resolve(selectedID == nil ? "自定义回答" : "补充说明（可选）")).font(.caption).foregroundStyle(.secondary)
                    TextField("输入你的回答", text: $draft, axis: .vertical)
                        .lineLimit(2 ... 6).textFieldStyle(.roundedBorder).disabled(disabled)
                        .onChange(of: draft) { _, value in
                            if !value.isEmpty {
                                editing = true
                            }
                        }
                    Text("\(trimmed.utf16.count)/8000").font(.caption)
                        .foregroundStyle(trimmed.utf16.count > 8000 ? Color.red : Color.secondary)
                    HStack {
                        Button("由助手决定") { onRespond("agent_decide", nil) }
                        Button("取消任务", role: .destructive) { onRespond("cancel", nil) }
                        Spacer()
                        Button("提交回答") { onRespond("answer", .input(choiceId: selectedID, text: trimmed.isEmpty ? nil : trimmed)) }
                            .buttonStyle(.borderedProminent)
                            .disabled((selectedID == nil && trimmed.isEmpty) || trimmed.utf16.count > 8000)
                    }.disabled(disabled)
                }
                if isSubmitting {
                    ProgressView().accessibilityLabel("正在提交")
                }
                if let errorMessage, !errorMessage.isEmpty {
                    Text(errorMessage).font(.caption).foregroundStyle(.red)
                }
            }
            .padding(14).frame(maxWidth: .infinity, alignment: .leading)
            .background(.background, in: .rect(cornerRadius: 16))
            .overlay(RoundedRectangle(cornerRadius: 16).stroke(.secondary.opacity(0.2)))
            .accessibilityElement(children: .contain)
        }
    }
}
