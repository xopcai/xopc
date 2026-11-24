import SwiftUI

private struct ClarificationWizardDraft: Codable, Equatable { var index = 0; var answers: [ClarificationAnswer] = []; var pendingAction: String? }

struct ClarificationWizard: View {
    @Environment(\.mobileTheme) private var mobileTheme; @Environment(\.colorScheme) private var colorScheme
    let clarification: ClarificationRequest; let isSubmitting: Bool; let errorMessage: String?
    let onRespond: (String, ClarificationSubmission?) -> Void
    @State private var draft = ClarificationWizardDraft(); @State private var storageError: String?
    @State private var ready = false; @State private var collapsed = false; @State private var expandedCustomID: String?
    private var palette: ClarificationPalette {
        ClarificationPalette(theme: mobileTheme, dark: colorScheme == .dark)
    }

    private var questions: [ClarificationQuestion] {
        clarification.questions ?? []
    }

    private var question: ClarificationQuestion? {
        questions.indices.contains(draft.index) ? questions[draft.index] : nil
    }

    private var answer: ClarificationAnswer? {
        draft.answers.first { $0.questionId == question?.id }
    }

    private var locked: Bool {
        !ready || isSubmitting || draft.pendingAction != nil || clarification.isExpired
    }

    private var complete: Bool {
        clarification.accepts(draft.answers)
    }

    private var answeredCount: Int {
        questions.filter(isAnswered).count
    }

    private func isAnswered(_ item: ClarificationQuestion) -> Bool {
        guard let entry = draft.answers.first(where: { $0.questionId == item.id }) else { return false }
        return entry.choiceId != nil || !(entry.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func update(choiceID: String?, text: String?) {
        guard let question else { return }
        let updated = ClarificationAnswer(questionId: question.id, choiceId: choiceID, text: text)
        if let idx = draft.answers.firstIndex(where: { $0.questionId == question.id }) {
            draft.answers[idx] = updated
        } else {
            draft.answers.append(updated)
        }
    }

    private func pickChoice(_ choiceID: String) {
        guard !locked, let question else { return }
        clarificationHaptic()
        let existingText = answer?.text
        update(choiceID: choiceID, text: existingText)
        if questions.count == 1, (existingText ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, expandedCustomID != question.id {
            submit("answer"); return
        }
        if let nextUnanswered = questions.firstIndex(where: { !isAnswered($0) }) {
            expandedCustomID = nil; withAnimation(.easeOut(duration: 0.18)) { draft.index = nextUnanswered }
        }
    }

    private func save() {
        do { try ClarificationPersistence.write(clarification, "draft", draft); storageError = nil } catch { storageError = error.localizedDescription }
    }

    private func submit(_ action: String) {
        draft.pendingAction = action
        do {
            try ClarificationPersistence.write(clarification, "draft", draft)
            var submission = ClarificationSubmission(response: nil, decision: nil)
            submission.answers = questions.compactMap { item in
                draft.answers.first { $0.questionId == item.id }.map {
                    let trimmed = $0.text?.trimmingCharacters(in: .whitespacesAndNewlines)
                    return ClarificationAnswer(questionId: $0.questionId, choiceId: $0.choiceId, text: trimmed?.isEmpty == true ? nil : trimmed)
                }
            }
            onRespond(action, action == "answer" ? submission : nil)
        } catch { storageError = error.localizedDescription }
    }

    private var summaryLine: String? {
        guard questions.count > 1, answeredCount == questions.count else { return nil }
        let parts = questions.compactMap { item -> String? in
            guard let entry = draft.answers.first(where: { $0.questionId == item.id }) else { return nil }
            let choiceLabel = item.choices?.first(where: { $0.id == entry.choiceId })?.label
            let text = entry.text?.trimmingCharacters(in: .whitespacesAndNewlines)
            return [choiceLabel, text].compactMap(\.self).filter { !$0.isEmpty }.joined(separator: " · ")
        }.filter { !$0.isEmpty }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    var body: some View {
        Group {
            if clarification.expiresAt != nil {
                TimelineView(.periodic(from: .now, by: 1)) { _ in wizardContent }
            } else {
                wizardContent
            }
        }
        .onAppear {
            draft = ClarificationPersistence.read(clarification, "draft", as: ClarificationWizardDraft.self) ?? ClarificationWizardDraft()
            draft.index = max(0, min(draft.index, max(0, questions.count - 1)))
            ready = true
        }
        .onChange(of: draft) { _, _ in
            guard ready else { return }
            save()
        }
    }

    @ViewBuilder
    private var wizardContent: some View {
        let isMulti = questions.count > 1
        if collapsed {
            ClarificationCollapsedBar(title: question?.header ?? AppLocalization.resolve("待确认"), progress: isMulti ? "\(answeredCount)/\(questions.count)" : nil,
                                      palette: palette, cornerRadius: mobileTheme.corner(18)) { withAnimation(.easeOut(duration: 0.18)) { collapsed = false } }
        } else {
            ClarificationCardShell(palette: palette, cornerRadius: mobileTheme.corner(20)) {
                VStack(alignment: .leading, spacing: 0) {
                    wizardHeader(isMulti: isMulti)
                    if let question {
                        wizardBody(question: question); wizardFooter(isMulti: isMulti, question: question)
                    }
                }
            }
        }
    }

    private func wizardHeader(isMulti: Bool) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                if isMulti {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 6) {
                            ForEach(Array(questions.enumerated()), id: \.element.id) { idx, item in
                                let active = idx == draft.index, done = isAnswered(item)
                                Button { expandedCustomID = nil; withAnimation(.easeOut(duration: 0.16)) { draft.index = idx } } label: {
                                    HStack(spacing: 4) {
                                        Text("\(idx + 1). \(item.header)").lineLimit(1); if done {
                                            Image(systemName: "checkmark").font(.system(size: 9, weight: .bold))
                                        }
                                    }
                                    .font(.caption.weight(.medium)).foregroundStyle(active ? palette.accentText : done ? palette.primaryText : palette.secondaryText)
                                    .padding(.horizontal, 10).padding(.vertical, 5).background(active ? palette.accentSoft : done ? palette.grouped : Color.clear, in: Capsule())
                                }.buttonStyle(.plain).disabled(locked)
                            }
                        }
                    }
                } else {
                    Text(question?.header ?? "").font(.caption.weight(.medium)).foregroundStyle(palette.secondaryText); Spacer()
                }
                if isMulti {
                    Text("\(answeredCount)/\(questions.count)").font(.caption2.monospacedDigit().weight(.medium)).foregroundStyle(palette.tertiaryText)
                }
                ClarificationHeaderActions(showMenu: draft.pendingAction == nil, disabled: locked, palette: palette, onAgentDecide: { submit("agent_decide") },
                                           onCancel: { submit("cancel") }, onCollapse: { withAnimation(.easeOut(duration: 0.18)) { collapsed = true } })
            }
            if isMulti {
                HStack(spacing: 4) {
                    ForEach(Array(questions.enumerated()), id: \.element.id) { idx, item in
                        Capsule().fill(isAnswered(item) ? palette.accent : idx == draft.index ? palette.accent.opacity(0.45) : palette.grouped).frame(height: 2.5)
                    }
                }
            }
        }.padding(.horizontal, 16).padding(.top, 12).padding(.bottom, 8)
    }

    private func wizardBody(question: ClarificationQuestion) -> some View {
        let choices = question.choices ?? []
        let showCustom = question.type != "single_choice" || expandedCustomID == question.id || !(answer?.text ?? "").isEmpty
        return ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text(question.question).font(.subheadline.weight(.semibold)).foregroundStyle(palette.primaryText)
                    .fixedSize(horizontal: false, vertical: true).textSelection(.enabled)
                if question.type == "single_choice" {
                    ClarificationOptionsGroup(choices: choices, recommendedID: question.recommendedChoiceId, selectedID: answer?.choiceId,
                                              customExpanded: showCustom, disabled: locked, palette: palette, onPick: pickChoice,
                                              onToggleCustom: { withAnimation(.easeOut(duration: 0.16)) { expandedCustomID = showCustom ? nil : question.id } })
                }
                if showCustom {
                    ClarificationCustomEditor(selectedLabel: choices.first { $0.id == answer?.choiceId }?.label,
                                              text: Binding(get: { answer?.text ?? "" }, set: { update(choiceID: answer?.choiceId, text: $0) }),
                                              limit: 2000, disabled: locked, palette: palette, onClearSelection: { update(choiceID: nil, text: answer?.text) })
                }
                if let summaryLine {
                    HStack(spacing: 6) {
                        Image(systemName: "checkmark.circle.fill").font(.caption).foregroundStyle(palette.accentText)
                        Text(summaryLine).font(.caption).foregroundStyle(palette.secondaryText).lineLimit(1)
                    }.padding(.horizontal, 12).padding(.vertical, 8).frame(maxWidth: .infinity, alignment: .leading)
                        .background(palette.grouped.opacity(0.8), in: .rect(cornerRadius: 10))
                }
                if !complete, answeredCount == questions.count, draft.answers.allSatisfy(\.valid) {
                    Text("内容过长，请精简").font(.caption).foregroundStyle(palette.danger)
                }
                if clarification.isExpired {
                    Text("已过期").font(.caption).foregroundStyle(palette.danger)
                }
                if let message = errorMessage ?? storageError {
                    Text(message).font(.caption).foregroundStyle(palette.danger)
                }
            }.padding(.horizontal, 16).padding(.bottom, 12)
        }.scrollBounceBehavior(.basedOnSize).frame(maxHeight: 320)
    }

    @ViewBuilder
    private func wizardFooter(isMulti: Bool, question: ClarificationQuestion) -> some View {
        let showCustom = question.type != "single_choice" || expandedCustomID == question.id || !(answer?.text ?? "").isEmpty
        if isMulti || showCustom || draft.pendingAction != nil || isSubmitting || complete {
            Rectangle().fill(palette.divider).frame(height: 0.5)
            HStack(spacing: 10) {
                if isMulti, draft.index > 0 {
                    Button { expandedCustomID = nil; withAnimation(.easeOut(duration: 0.16)) { draft.index -= 1 } } label: {
                        Text("上一题").font(.subheadline.weight(.medium)).foregroundStyle(palette.tonalText)
                            .padding(.horizontal, 14).frame(minHeight: 38).background(palette.tonalFill, in: Capsule())
                    }.buttonStyle(.plain).disabled(isSubmitting)
                }
                Spacer()
                if isMulti, !complete, draft.index < questions.count - 1, draft.pendingAction == nil {
                    Button { expandedCustomID = nil; withAnimation(.easeOut(duration: 0.16)) { draft.index += 1 } } label: {
                        Text("下一题").font(.subheadline.weight(.semibold)).foregroundStyle(palette.onAccent).padding(.horizontal, 18).frame(minHeight: 38)
                            .background(palette.accent.opacity((isSubmitting || !isAnswered(question)) ? 0.4 : 1), in: Capsule())
                    }.buttonStyle(.plain).disabled(isSubmitting || !isAnswered(question))
                } else {
                    let canSubmit = ready && !isSubmitting && !clarification.isExpired && (complete || draft.pendingAction != nil)
                    Button { clarificationHaptic(); submit(draft.pendingAction ?? "answer") } label: {
                        Group {
                            if isSubmitting {
                                ProgressView().tint(palette.onAccent)
                            } else {
                                Text(draft.pendingAction == nil ? "确认" : "重试").font(.subheadline.weight(.semibold))
                            }
                        }
                        .foregroundStyle(palette.onAccent).padding(.horizontal, 20).frame(minHeight: 38)
                        .background(palette.accent.opacity(canSubmit ? 1 : 0.4), in: Capsule())
                    }.buttonStyle(.plain).disabled(!canSubmit)
                }
            }.padding(.horizontal, 16).padding(.vertical, 10)
        }
    }
}
