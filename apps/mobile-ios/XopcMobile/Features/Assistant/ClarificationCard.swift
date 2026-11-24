import SwiftUI
import UIKit

private struct ClarificationPalette {
    let surface, grouped, divider, border, shadow, primaryText, secondaryText, tertiaryText: Color
    let accent, onAccent, accentSoft, accentText, tonalFill, tonalText, inputFill, badgeAmberFill, badgeAmberTint, danger: Color
    init(theme: MobileTheme, dark: Bool) {
        let isDefault = theme.preset == .default
        surface = isDefault ? Self.hex(dark ? 0x1E222A : 0xFFFFFF) : theme.panel
        grouped = isDefault ? Self.hex(dark ? 0x262B35 : 0xF5F6F8) : theme.grouped
        divider = dark ? Color.white.opacity(0.07) : Color.black.opacity(0.06)
        border = dark ? Color.white.opacity(0.09) : Color.black.opacity(0.08)
        shadow = dark ? Color.black.opacity(0.45) : Color.black.opacity(0.07)
        primaryText = isDefault ? Self.hex(dark ? 0xF3F5F8 : 0x111318) : theme.foreground
        secondaryText = isDefault ? Self.hex(dark ? 0x9CA5B4 : 0x5F6672) : theme.secondary
        tertiaryText = isDefault ? Self.hex(dark ? 0x6C7585 : 0x8E95A2) : theme.secondary.opacity(0.75)
        accent = isDefault ? Self.hex(0x3A6BFF) : theme.action; onAccent = isDefault ? .white : theme.onAction
        accentSoft = isDefault ? (dark ? Self.hex(0x4C82FF).opacity(0.18) : Self.hex(0xEDF3FF)) : theme.active
        accentText = isDefault ? Self.hex(dark ? 0x96B6FF : 0x2B5CE6) : theme.action
        tonalFill = isDefault ? (dark ? Color.white.opacity(0.08) : Self.hex(0xEFF1F5)) : theme.grouped
        tonalText = isDefault ? Self.hex(dark ? 0xE6EAF0 : 0x1D2129) : theme.foreground
        inputFill = isDefault ? Self.hex(dark ? 0x161920 : 0xFFFFFF) : theme.panel
        badgeAmberFill = dark ? Self.hex(0xF59E0B).opacity(0.16) : Self.hex(0xFEF3E2)
        badgeAmberTint = Self.hex(dark ? 0xFBBF24 : 0xB45309); danger = theme.danger
    }
    private static func hex(_ rgb: UInt32) -> Color {
        Color(red: Double((rgb >> 16) & 255) / 255, green: Double((rgb >> 8) & 255) / 255, blue: Double(rgb & 255) / 255)
    }
}

private func clarificationHaptic() { UIImpactFeedbackGenerator(style: .light).impactOccurred() }

private struct ClarificationCardShell<Content: View>: View {
    let palette: ClarificationPalette; let cornerRadius: CGFloat; @ViewBuilder let content: Content
    var body: some View {
        content.background(palette.surface, in: .rect(cornerRadius: cornerRadius))
            .overlay(RoundedRectangle(cornerRadius: cornerRadius).stroke(palette.border, lineWidth: 0.5))
            .shadow(color: palette.shadow, radius: 16, y: 6).accessibilityElement(children: .contain)
    }
}

private struct ClarificationCollapsedBar: View {
    let title: String; let progress: String?; let palette: ClarificationPalette; let cornerRadius: CGFloat; let onExpand: () -> Void
    var body: some View {
        HStack(spacing: 10) {
            Circle().fill(palette.accent).frame(width: 8, height: 8)
            Text(title).font(.subheadline.weight(.medium)).foregroundStyle(palette.primaryText).lineLimit(1)
            if let progress { Text(progress).font(.caption.monospacedDigit()).foregroundStyle(palette.secondaryText) }
            Spacer(minLength: 4)
            Button(action: onExpand) {
                HStack(spacing: 4) { Text("继续").font(.caption.weight(.semibold)); Image(systemName: "chevron.up").font(.system(size: 10, weight: .semibold)) }
                    .foregroundStyle(palette.tonalText).padding(.horizontal, 12).padding(.vertical, 7).background(palette.tonalFill, in: Capsule())
            }.buttonStyle(.plain)
        }.padding(.horizontal, 14).padding(.vertical, 10).frame(maxWidth: .infinity, minHeight: 48)
            .background(palette.surface, in: .rect(cornerRadius: cornerRadius))
            .overlay(RoundedRectangle(cornerRadius: cornerRadius).stroke(palette.border, lineWidth: 0.5))
            .shadow(color: palette.shadow, radius: 10, y: 4)
    }
}

private struct ClarificationOptionsGroup: View {
    let choices: [ClarificationChoice]; let recommendedID, selectedID: String?; let customExpanded, disabled: Bool
    let palette: ClarificationPalette; let onPick: (String) -> Void; let onToggleCustom: () -> Void
    var body: some View {
        VStack(spacing: 0) {
            ForEach(Array(choices.enumerated()), id: \.element.id) { index, choice in
                if index > 0 { Rectangle().fill(palette.divider).frame(height: 0.5).padding(.leading, 14) }
                choiceRow(choice)
            }
            Rectangle().fill(palette.divider).frame(height: 0.5).padding(.leading, 14)
            Button(action: onToggleCustom) {
                HStack(spacing: 10) {
                    Image(systemName: "pencil").font(.caption).foregroundStyle(palette.tertiaryText)
                    Text(selectedID == nil ? "其他…" : "补充说明…").font(.subheadline).foregroundStyle(palette.secondaryText)
                    Spacer()
                    Image(systemName: "chevron.right").font(.caption2.weight(.semibold)).foregroundStyle(palette.tertiaryText)
                        .rotationEffect(.degrees(customExpanded ? 90 : 0))
                }.padding(.horizontal, 14).padding(.vertical, 12).frame(maxWidth: .infinity, minHeight: 46).contentShape(.rect)
            }.buttonStyle(.plain).disabled(disabled)
        }.background(palette.grouped, in: .rect(cornerRadius: 14))
    }

    private func choiceRow(_ choice: ClarificationChoice) -> some View {
        let selected = selectedID == choice.id
        return Button { onPick(choice.id) } label: {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(choice.label).font(.subheadline.weight(.medium))
                            .foregroundStyle(selected ? palette.accentText : palette.primaryText).multilineTextAlignment(.leading)
                        if choice.id == recommendedID {
                            Text("推荐").font(.caption2.weight(.medium)).foregroundStyle(palette.accentText)
                                .padding(.horizontal, 7).padding(.vertical, 2).background(palette.accentSoft, in: Capsule())
                        }
                    }
                    if let description = choice.description, !description.isEmpty {
                        Text(description).font(.caption).foregroundStyle(palette.secondaryText).multilineTextAlignment(.leading)
                    }
                }
                Spacer(minLength: 4)
                ZStack {
                    if selected {
                        Circle().fill(palette.accent).frame(width: 20, height: 20)
                        Image(systemName: "checkmark").font(.system(size: 10, weight: .bold)).foregroundStyle(palette.onAccent)
                    } else { Circle().stroke(palette.tertiaryText.opacity(0.55), lineWidth: 1.5).frame(width: 20, height: 20) }
                }.accessibilityHidden(true)
            }.padding(.horizontal, 14).padding(.vertical, 12).frame(maxWidth: .infinity, minHeight: 48, alignment: .leading)
                .background(selected ? palette.accentSoft : Color.clear).contentShape(.rect)
        }.buttonStyle(.plain).disabled(disabled).accessibilityAddTraits(selected ? .isSelected : [])
    }
}

private struct ClarificationCustomEditor: View {
    let selectedLabel: String?; @Binding var text: String; let limit: Int; let disabled: Bool; let palette: ClarificationPalette; let onClearSelection: () -> Void
    var body: some View {
        let count = text.trimmingCharacters(in: .whitespacesAndNewlines).utf16.count
        VStack(alignment: .leading, spacing: 6) {
            if let selectedLabel {
                HStack {
                    Text(selectedLabel).font(.caption).foregroundStyle(palette.secondaryText).lineLimit(1); Spacer()
                    Button("清除", action: onClearSelection).font(.caption).foregroundStyle(palette.tertiaryText).disabled(disabled)
                }
            }
            TextField(selectedLabel == nil ? "输入回答…" : "补充说明…", text: $text, axis: .vertical)
                .font(.subheadline).foregroundStyle(palette.primaryText).lineLimit(2 ... 5)
                .padding(11).background(palette.inputFill, in: .rect(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(count > limit ? palette.danger : palette.border, lineWidth: 1)).disabled(disabled)
            if count >= (limit * 4) / 5 {
                Text("\(count)/\(limit)").font(.caption2.monospacedDigit()).foregroundStyle(count > limit ? palette.danger : palette.tertiaryText)
            }
        }
    }
}

private struct ClarificationHeaderActions: View {
    let showMenu, disabled: Bool; let palette: ClarificationPalette; let onAgentDecide, onCancel, onCollapse: () -> Void
    var body: some View {
        HStack(spacing: 2) {
            if showMenu {
                Menu {
                    Button("交给助手", systemImage: "sparkles", action: onAgentDecide)
                    Button("取消", systemImage: "xmark", role: .destructive, action: onCancel)
                } label: {
                    Image(systemName: "ellipsis").font(.system(size: 14, weight: .semibold)).foregroundStyle(palette.secondaryText)
                        .frame(width: 30, height: 30).contentShape(.rect)
                }.disabled(disabled).accessibilityLabel("更多操作")
            }
            Button(action: onCollapse) {
                Image(systemName: "chevron.down").font(.system(size: 13, weight: .semibold)).foregroundStyle(palette.secondaryText)
                    .frame(width: 30, height: 30).contentShape(.rect)
            }.buttonStyle(.plain).accessibilityLabel("收起")
        }
    }
}

struct ClarificationCard: View {
    @Environment(\.mobileTheme) private var mobileTheme; @Environment(\.colorScheme) private var colorScheme
    let clarification: ClarificationRequest; let isSubmitting: Bool; let errorMessage: String?
    let onRespond: (String, ClarificationSubmission?) -> Void
    @State private var draft = ""; @State private var selectedID: String?
    @State private var editing = false; @State private var collapsed = false; @State private var paramsExpanded = false
    private var palette: ClarificationPalette { ClarificationPalette(theme: mobileTheme, dark: colorScheme == .dark) }
    private var trimmed: String { draft.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var choices: [ClarificationChoice] { clarification.choiceDetails ?? [] }
    private var compose: Bool { editing || choices.isEmpty }
    var body: some View {
        if clarification.schemaVersion == 2 {
            ClarificationWizard(clarification: clarification, isSubmitting: isSubmitting, errorMessage: errorMessage, onRespond: onRespond)
                .id("\(clarification.scope ?? "").\(clarification.id).\(clarification.version)")
        } else if clarification.expiresAt != nil { TimelineView(.periodic(from: .now, by: 1)) { legacyBody(now: $0.date) } }
        else { legacyBody(now: .now) }
    }
    private func remainingSeconds(at date: Date) -> Int? {
        clarification.expiresAt.map { max(0, Int((Double($0) / 1000 - date.timeIntervalSince1970 - Double(clarification.clockOffset ?? 0) / 1000).rounded(.up))) }
    }
    @ViewBuilder private func legacyBody(now: Date) -> some View {
        let remaining = remainingSeconds(at: now), expired = remaining == 0, disabled = isSubmitting || expired
        if collapsed, clarification.kind != "approval" {
            ClarificationCollapsedBar(title: clarification.question, progress: nil, palette: palette, cornerRadius: mobileTheme.corner(18)) {
                withAnimation(.easeOut(duration: 0.18)) { collapsed = false }
            }
        } else if clarification.kind == "approval" { approvalBody(remaining: remaining, expired: expired, disabled: disabled) }
        else { inputBody(remaining: remaining, expired: expired, disabled: disabled) }
    }

    private func approvalBody(remaining: Int?, expired: Bool, disabled: Bool) -> some View {
        let approval = clarification.approval
        return ClarificationCardShell(palette: palette, cornerRadius: mobileTheme.corner(20)) {
            VStack(alignment: .leading, spacing: 14) {
                approvalHeader(operation: approval?.operation ?? clarification.question, remaining: remaining, expired: expired)
                if let operation = approval?.operation, !clarification.question.isEmpty,
                   clarification.question.trimmingCharacters(in: .whitespacesAndNewlines) != operation.trimmingCharacters(in: .whitespacesAndNewlines)
                { Text(clarification.question).font(.footnote).foregroundStyle(palette.secondaryText).fixedSize(horizontal: false, vertical: true) }
                if let approval, approval.target != nil || approval.impact != nil || approval.preview != nil { approvalDetails(approval) }
                if let errorMessage, !errorMessage.isEmpty { Text(errorMessage).font(.caption).foregroundStyle(palette.danger) }
                Text("仅本次生效").font(.caption).foregroundStyle(palette.tertiaryText)
                HStack(spacing: 10) {
                    Button { clarificationHaptic(); onRespond("answer", .approval("deny")) } label: {
                        Text("拒绝").font(.subheadline.weight(.medium)).foregroundStyle(palette.tonalText)
                            .frame(maxWidth: .infinity, minHeight: 44).background(palette.tonalFill, in: .rect(cornerRadius: 12))
                    }.buttonStyle(.plain).disabled(disabled)
                    Button { clarificationHaptic(); onRespond("answer", .approval("approve")) } label: {
                        Group { if isSubmitting { ProgressView().tint(palette.onAccent) } else { Text("允许").font(.subheadline.weight(.semibold)) } }
                            .foregroundStyle(palette.onAccent).frame(maxWidth: .infinity, minHeight: 44)
                            .background(palette.accent.opacity(disabled ? 0.45 : 1), in: .rect(cornerRadius: 12))
                    }.buttonStyle(.plain).disabled(disabled)
                }
            }.padding(16)
        }
    }

    private func approvalHeader(operation: String, remaining: Int?, expired: Bool) -> some View {
        let urgent = (remaining ?? 999) > 0 && (remaining ?? 999) <= 60
        let countdown = remaining.map { $0 == 0 ? AppLocalization.resolve("已过期") : String(format: "%d:%02d", $0 / 60, $0 % 60) }
        return HStack(spacing: 10) {
            ZStack {
                RoundedRectangle(cornerRadius: 10).fill(palette.badgeAmberFill).frame(width: 34, height: 34)
                Image(systemName: "checkmark.shield.fill").font(.system(size: 16, weight: .semibold)).foregroundStyle(palette.badgeAmberTint)
            }.accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text("确认操作").font(.caption.weight(.medium)).foregroundStyle(palette.secondaryText)
                Text(operation).font(.subheadline.weight(.semibold)).foregroundStyle(palette.primaryText).fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 4)
            if let countdown {
                Text(countdown).font(.caption.monospacedDigit().weight(.medium))
                    .foregroundStyle(expired ? palette.danger : urgent ? palette.badgeAmberTint : palette.secondaryText)
                    .padding(.horizontal, 9).padding(.vertical, 4)
                    .background(expired ? palette.danger.opacity(0.12) : urgent ? palette.badgeAmberFill : palette.grouped, in: Capsule())
            }
        }
    }

    private func approvalDetails(_ approval: ClarificationApproval) -> some View {
        VStack(spacing: 0) {
            if let target = approval.target, !target.isEmpty { approvalRow(label: "目标", value: target) }
            if let impact = approval.impact, !impact.isEmpty {
                if approval.target?.isEmpty == false { Rectangle().fill(palette.divider).frame(height: 0.5).padding(.leading, 14) }
                approvalRow(label: "影响", value: impact)
            }
            if let preview = approval.preview {
                if approval.target?.isEmpty == false || approval.impact?.isEmpty == false { Rectangle().fill(palette.divider).frame(height: 0.5).padding(.leading, 14) }
                Button { withAnimation(.easeOut(duration: 0.16)) { paramsExpanded.toggle() } } label: {
                    HStack(spacing: 10) {
                        Text("参数").font(.caption).foregroundStyle(palette.tertiaryText).frame(width: 40, alignment: .leading)
                        Text(String(format: AppLocalization.resolve("%lld 项"), approval.argumentsPreview?.count ?? 0)).font(.caption).foregroundStyle(palette.secondaryText)
                        Spacer()
                        Image(systemName: "chevron.right").font(.system(size: 11, weight: .semibold)).foregroundStyle(palette.tertiaryText)
                            .rotationEffect(.degrees(paramsExpanded ? 90 : 0))
                    }.padding(.horizontal, 14).padding(.vertical, 10).contentShape(.rect)
                }.buttonStyle(.plain)
                if paramsExpanded {
                    ScrollView { Text(preview).font(.caption2.monospaced()).foregroundStyle(palette.secondaryText).frame(maxWidth: .infinity, alignment: .leading).textSelection(.enabled) }
                        .frame(maxHeight: 130).padding(.horizontal, 14).padding(.bottom, 10)
                }
            }
        }.background(palette.grouped, in: .rect(cornerRadius: 14))
    }

    private func approvalRow(label: LocalizedStringKey, value: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text(label).font(.caption).foregroundStyle(palette.tertiaryText).frame(width: 40, alignment: .leading)
            Text(value).font(.caption).foregroundStyle(palette.primaryText).frame(maxWidth: .infinity, alignment: .leading).fixedSize(horizontal: false, vertical: true).textSelection(.enabled)
        }.padding(.horizontal, 14).padding(.vertical, 10)
    }

    private func inputBody(remaining: Int?, expired: Bool, disabled: Bool) -> some View {
        let canSend = !disabled && (selectedID != nil || !trimmed.isEmpty) && trimmed.utf16.count <= 8000
        return ClarificationCardShell(palette: palette, cornerRadius: mobileTheme.corner(20)) {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 8) {
                    if let remaining {
                        Text(remaining == 0 ? AppLocalization.resolve("已过期") : String(format: "%d:%02d", remaining / 60, remaining % 60))
                            .font(.caption2.monospacedDigit()).foregroundStyle(expired ? palette.danger : palette.secondaryText)
                    }
                    Spacer()
                    ClarificationHeaderActions(showMenu: true, disabled: disabled, palette: palette, onAgentDecide: { onRespond("agent_decide", nil) },
                                               onCancel: { onRespond("cancel", nil) }, onCollapse: { withAnimation(.easeOut(duration: 0.18)) { collapsed = true } })
                }.padding(.horizontal, 14).padding(.top, 10).padding(.bottom, 4)

                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        Text(clarification.question).font(.subheadline.weight(.semibold)).foregroundStyle(palette.primaryText)
                            .fixedSize(horizontal: false, vertical: true).textSelection(.enabled)
                        if !choices.isEmpty {
                            ClarificationOptionsGroup(choices: choices, recommendedID: clarification.recommendedChoiceId, selectedID: selectedID,
                                                      customExpanded: compose, disabled: disabled, palette: palette,
                                                      onPick: { choiceID in
                                                          clarificationHaptic()
                                                          if compose || !draft.isEmpty { editing = true; selectedID = choiceID }
                                                          else { selectedID = choiceID; onRespond("answer", .input(choiceId: choiceID)) }
                                                      },
                                                      onToggleCustom: { withAnimation(.easeOut(duration: 0.16)) { editing.toggle() } })
                        }
                        if compose {
                            ClarificationCustomEditor(selectedLabel: choices.first { $0.id == selectedID }?.label,
                                                      text: Binding(get: { draft }, set: { draft = $0; if !$0.isEmpty { editing = true } }),
                                                      limit: 8000, disabled: disabled, palette: palette, onClearSelection: { selectedID = nil })
                        }
                        if let errorMessage, !errorMessage.isEmpty { Text(errorMessage).font(.caption).foregroundStyle(palette.danger) }
                    }.padding(.horizontal, 16).padding(.bottom, 12)
                }.scrollBounceBehavior(.basedOnSize).frame(maxHeight: 320)

                if compose || isSubmitting {
                    Rectangle().fill(palette.divider).frame(height: 0.5)
                    HStack {
                        Spacer()
                        Button { clarificationHaptic(); onRespond("answer", .input(choiceId: selectedID, text: trimmed.isEmpty ? nil : trimmed)) } label: {
                            Group { if isSubmitting { ProgressView().tint(palette.onAccent) } else { Text("发送").font(.subheadline.weight(.semibold)) } }
                                .foregroundStyle(palette.onAccent).padding(.horizontal, 20).frame(minHeight: 38)
                                .background(palette.accent.opacity(canSend ? 1 : 0.4), in: Capsule())
                        }.buttonStyle(.plain).disabled(!canSend)
                    }.padding(.horizontal, 16).padding(.vertical, 10)
                }
            }
        }
    }
}

private struct ClarificationWizardDraft: Codable, Equatable { var index = 0; var answers: [ClarificationAnswer] = []; var pendingAction: String? }

private struct ClarificationWizard: View {
    @Environment(\.mobileTheme) private var mobileTheme; @Environment(\.colorScheme) private var colorScheme
    let clarification: ClarificationRequest; let isSubmitting: Bool; let errorMessage: String?
    let onRespond: (String, ClarificationSubmission?) -> Void
    @State private var draft = ClarificationWizardDraft(); @State private var storageError: String?
    @State private var ready = false; @State private var collapsed = false; @State private var expandedCustomID: String?
    private var palette: ClarificationPalette { ClarificationPalette(theme: mobileTheme, dark: colorScheme == .dark) }
    private var questions: [ClarificationQuestion] { clarification.questions ?? [] }
    private var question: ClarificationQuestion? { questions.indices.contains(draft.index) ? questions[draft.index] : nil }
    private var answer: ClarificationAnswer? { draft.answers.first { $0.questionId == question?.id } }
    private var locked: Bool { !ready || isSubmitting || draft.pendingAction != nil || clarification.isExpired }
    private var complete: Bool { clarification.accepts(draft.answers) }
    private var answeredCount: Int { questions.filter(isAnswered).count }

    private func isAnswered(_ item: ClarificationQuestion) -> Bool {
        guard let entry = draft.answers.first(where: { $0.questionId == item.id }) else { return false }
        return entry.choiceId != nil || !(entry.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
    private func update(choiceID: String?, text: String?) {
        guard let question else { return }
        let updated = ClarificationAnswer(questionId: question.id, choiceId: choiceID, text: text)
        if let idx = draft.answers.firstIndex(where: { $0.questionId == question.id }) { draft.answers[idx] = updated } else { draft.answers.append(updated) }
    }
    private func pickChoice(_ choiceID: String) {
        guard !locked, let question else { return }
        clarificationHaptic()
        let existingText = answer?.text
        update(choiceID: choiceID, text: existingText)
        if questions.count == 1, (existingText ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, expandedCustomID != question.id { submit("answer"); return }
        if let nextUnanswered = questions.firstIndex(where: { !isAnswered($0) }) { expandedCustomID = nil; withAnimation(.easeOut(duration: 0.18)) { draft.index = nextUnanswered } }
    }
    private func save() { do { try ClarificationPersistence.write(clarification, "draft", draft); storageError = nil } catch { storageError = error.localizedDescription } }

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
        Group { if clarification.expiresAt != nil { TimelineView(.periodic(from: .now, by: 1)) { _ in wizardContent } } else { wizardContent } }
            .onAppear {
                draft = ClarificationPersistence.read(clarification, "draft", as: ClarificationWizardDraft.self) ?? ClarificationWizardDraft()
                draft.index = max(0, min(draft.index, max(0, questions.count - 1)))
                ready = true
            }
            .onChange(of: draft) { _, _ in if ready { save() } }
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
                    if let question { wizardBody(question: question); wizardFooter(isMulti: isMulti, question: question) }
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
                                    HStack(spacing: 4) { Text("\(idx + 1). \(item.header)").lineLimit(1); if done { Image(systemName: "checkmark").font(.system(size: 9, weight: .bold)) } }
                                        .font(.caption.weight(.medium)).foregroundStyle(active ? palette.accentText : done ? palette.primaryText : palette.secondaryText)
                                        .padding(.horizontal, 10).padding(.vertical, 5).background(active ? palette.accentSoft : done ? palette.grouped : Color.clear, in: Capsule())
                                }.buttonStyle(.plain).disabled(locked)
                            }
                        }
                    }
                } else { Text(question?.header ?? "").font(.caption.weight(.medium)).foregroundStyle(palette.secondaryText); Spacer() }
                if isMulti { Text("\(answeredCount)/\(questions.count)").font(.caption2.monospacedDigit().weight(.medium)).foregroundStyle(palette.tertiaryText) }
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
                if !complete, answeredCount == questions.count, draft.answers.allSatisfy(\.valid) { Text("内容过长，请精简").font(.caption).foregroundStyle(palette.danger) }
                if clarification.isExpired { Text("已过期").font(.caption).foregroundStyle(palette.danger) }
                if let message = errorMessage ?? storageError { Text(message).font(.caption).foregroundStyle(palette.danger) }
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
                        Group { if isSubmitting { ProgressView().tint(palette.onAccent) } else { Text(draft.pendingAction == nil ? "确认" : "重试").font(.subheadline.weight(.semibold)) } }
                            .foregroundStyle(palette.onAccent).padding(.horizontal, 20).frame(minHeight: 38)
                            .background(palette.accent.opacity(canSubmit ? 1 : 0.4), in: Capsule())
                    }.buttonStyle(.plain).disabled(!canSubmit)
                }
            }.padding(.horizontal, 16).padding(.vertical, 10)
        }
    }
}
