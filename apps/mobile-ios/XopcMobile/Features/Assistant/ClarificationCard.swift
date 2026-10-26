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
        if clarification.schemaVersion == 2 {
            ClarificationWizard(clarification: clarification, isSubmitting: isSubmitting, errorMessage: errorMessage, onRespond: onRespond)
                .id("\(clarification.scope ?? "").\(clarification.id).\(clarification.version)")
        } else { legacyBody }
    }

    private var legacyBody: some View {
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

private struct ClarificationWizardDraft: Codable, Equatable {
    var index = 0
    var answers: [ClarificationAnswer] = []
    var pendingAction: String?
}

private struct ClarificationWizard: View {
    let clarification: ClarificationRequest
    let isSubmitting: Bool
    let errorMessage: String?
    let onRespond: (String, ClarificationSubmission?) -> Void
    @State private var draft = ClarificationWizardDraft()
    @State private var storageError: String?
    @State private var ready = false

    private var questions: [ClarificationQuestion] { clarification.questions ?? [] }
    private var question: ClarificationQuestion? { questions.indices.contains(draft.index) ? questions[draft.index] : nil }
    private var answer: ClarificationAnswer? { draft.answers.first { $0.questionId == question?.id } }
    private var locked: Bool { !ready || isSubmitting || draft.pendingAction != nil || clarification.isExpired }
    private var complete: Bool { clarification.accepts(draft.answers) }

    private func update(choiceID: String?, text: String?) {
        guard let question else { return }
        let updated = ClarificationAnswer(questionId: question.id, choiceId: choiceID, text: text)
        if let index = draft.answers.firstIndex(where: { $0.questionId == question.id }) { draft.answers[index] = updated }
        else { draft.answers.append(updated) }
    }

    private func save() {
        do { try ClarificationPersistence.write(clarification, "draft", draft); storageError = nil }
        catch { storageError = error.localizedDescription }
    }

    private func submit(_ action: String) {
        draft.pendingAction = action
        do {
            try ClarificationPersistence.write(clarification, "draft", draft)
            var submission = ClarificationSubmission(response: nil, decision: nil)
            submission.answers = questions.compactMap { question in
                draft.answers.first { $0.questionId == question.id }.map {
                    ClarificationAnswer(questionId: $0.questionId, choiceId: $0.choiceId,
                        text: $0.text.flatMap { text in let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines); return trimmed.isEmpty ? nil : trimmed })
                }
            }
            onRespond(action, action == "answer" ? submission : nil)
        } catch { storageError = error.localizedDescription }
    }

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { _ in
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    Label("助手需要补充信息", systemImage: "questionmark.bubble").font(.headline)
                    if let question {
                        Text("\(draft.index + 1)/\(questions.count) · \(question.header)").font(.subheadline)
                        Text(question.question).textSelection(.enabled)
                        ForEach(question.choices ?? []) { choice in
                            Button { update(choiceID: choice.id, text: answer?.text) } label: {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text((answer?.choiceId == choice.id ? "✓ " : "") + choice.label)
                                    if choice.id == question.recommendedChoiceId { Text("推荐").font(.caption).foregroundStyle(.blue) }
                                    if let description = choice.description { Text(description).font(.caption).foregroundStyle(.secondary) }
                                }.frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 4)
                            }.buttonStyle(.bordered).disabled(locked)
                                .accessibilityAddTraits(answer?.choiceId == choice.id ? .isSelected : [])
                        }
                        if answer?.choiceId != nil {
                            Button("清除选择") { update(choiceID: nil, text: answer?.text) }.disabled(locked)
                        }
                        Text(AppLocalization.resolve(answer?.choiceId == nil ? "自定义回答" : "补充说明（可选）")).font(.caption)
                        TextField("输入你的回答", text: Binding(get: { answer?.text ?? "" }, set: { update(choiceID: answer?.choiceId, text: $0) }), axis: .vertical)
                            .lineLimit(2 ... 5).textFieldStyle(.roundedBorder).disabled(locked)
                        Text("\((answer?.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines).utf16.count)/2000").font(.caption).foregroundStyle(.secondary)
                        if !complete && draft.answers.count == questions.count && draft.answers.allSatisfy(\.valid) {
                            Text("回答内容过长，请精简后再提交").font(.caption).foregroundStyle(.red)
                        }
                        HStack {
                            Button("上一题") { draft.index -= 1 }.disabled(draft.index == 0 || isSubmitting)
                            if draft.index < questions.count - 1 { Button("下一题") { draft.index += 1 }.disabled(isSubmitting) }
                            Spacer()
                            Button(draft.pendingAction == nil ? "提交回答" : "重试提交") { submit(draft.pendingAction ?? "answer") }
                                .buttonStyle(.borderedProminent).disabled(!ready || isSubmitting || clarification.isExpired || (!complete && draft.pendingAction == nil))
                        }
                        if draft.pendingAction == nil {
                            HStack {
                                Button("由助手决定") { submit("agent_decide") }
                                Button("取消任务", role: .destructive) { submit("cancel") }
                            }.disabled(locked)
                        }
                    }
                    if clarification.isExpired { Text("此请求已过期").font(.caption) }
                    if isSubmitting { ProgressView().accessibilityLabel("正在提交") }
                    if let message = errorMessage ?? storageError { Text(message).font(.caption).foregroundStyle(.red) }
                }.padding(14).frame(maxWidth: .infinity, alignment: .leading)
            }.frame(maxHeight: 420)
                .background(.background, in: .rect(cornerRadius: 16))
                .overlay(RoundedRectangle(cornerRadius: 16).stroke(.secondary.opacity(0.2)))
        }
        .onAppear {
            draft = ClarificationPersistence.read(clarification, "draft", as: ClarificationWizardDraft.self) ?? ClarificationWizardDraft()
            draft.index = max(0, min(draft.index, questions.count - 1))
            ready = true
        }
        .onChange(of: draft) { _, _ in if ready { save() } }
    }
}
