import SwiftUI
import UIKit

struct ClarificationPalette {
    let surface, grouped, divider, border, shadow, primaryText, secondaryText, tertiaryText: Color
    let accent, onAccent, accentSoft, accentText, tonalFill, tonalText, inputFill, badgeAmberFill, badgeAmberTint, danger: Color
    init(theme: MobileTheme, dark: Bool) {
        surface = theme.panel
        grouped = theme.grouped
        divider = dark ? Color.white.opacity(0.07) : Color.black.opacity(0.06)
        border = dark ? Color.white.opacity(0.09) : Color.black.opacity(0.08)
        shadow = theme.scrim.opacity(dark ? 0.45 : 0.16)
        primaryText = theme.foreground
        secondaryText = theme.secondary
        tertiaryText = theme.secondary.opacity(0.75)
        accent = theme.action
        onAccent = theme.onAction
        accentSoft = theme.active
        accentText = theme.action
        tonalFill = theme.input
        tonalText = theme.foreground
        inputFill = theme.canvas
        badgeAmberFill = theme.warningFill
        badgeAmberTint = theme.warningForeground
        danger = theme.danger
    }
}

func clarificationHaptic() {
    UIImpactFeedbackGenerator(style: .light).impactOccurred()
}

struct ClarificationCardShell<Content: View>: View {
    let palette: ClarificationPalette; let cornerRadius: CGFloat; @ViewBuilder let content: Content
    var body: some View {
        content.background(palette.surface, in: .rect(cornerRadius: cornerRadius))
            .shadow(color: palette.shadow, radius: 12, y: 4).accessibilityElement(children: .contain)
    }
}

struct ClarificationCollapsedBar: View {
    let title: String; let progress: String?; let palette: ClarificationPalette; let cornerRadius: CGFloat; let onExpand: () -> Void
    var body: some View {
        HStack(spacing: 10) {
            Circle().fill(palette.accent).frame(width: 8, height: 8)
            Text(title).font(.subheadline.weight(.medium)).foregroundStyle(palette.primaryText).lineLimit(1)
            if let progress {
                Text(progress).font(.caption.monospacedDigit()).foregroundStyle(palette.secondaryText)
            }
            Spacer(minLength: 4)
            Button(action: onExpand) {
                HStack(spacing: 4) { Text("继续").font(.caption.weight(.semibold)); Image(systemName: "chevron.up").font(.caption2.weight(.semibold)) }
                    .foregroundStyle(palette.tonalText).padding(.horizontal, 12).padding(.vertical, 7).background(palette.tonalFill, in: Capsule())
            }.buttonStyle(.plain)
        }.padding(.horizontal, 14).padding(.vertical, 10).frame(maxWidth: .infinity, minHeight: 48)
            .background(palette.surface, in: .rect(cornerRadius: cornerRadius))
            .shadow(color: palette.shadow, radius: 8, y: 3)
    }
}

struct ClarificationOptionsGroup: View {
    let choices: [ClarificationChoice]; let recommendedID, selectedID: String?; let customExpanded, disabled: Bool
    let palette: ClarificationPalette; let onPick: (String) -> Void; let onToggleCustom: () -> Void
    var body: some View {
        VStack(spacing: 0) {
            ForEach(Array(choices.enumerated()), id: \.element.id) { index, choice in
                if index > 0 {
                    Rectangle().fill(palette.divider).frame(height: 0.5).padding(.leading, 14)
                }
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
                        Image(systemName: "checkmark").font(.caption2.weight(.bold)).foregroundStyle(palette.onAccent)
                    } else {
                        Circle().stroke(palette.tertiaryText.opacity(0.55), lineWidth: 1.5).frame(width: 20, height: 20)
                    }
                }.accessibilityHidden(true)
            }.padding(.horizontal, 14).padding(.vertical, 12).frame(maxWidth: .infinity, minHeight: 48, alignment: .leading)
                .background(selected ? palette.accentSoft : Color.clear).contentShape(.rect)
        }.buttonStyle(.plain).disabled(disabled).accessibilityAddTraits(selected ? .isSelected : [])
    }
}

struct ClarificationCustomEditor: View {
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

struct ClarificationHeaderActions: View {
    let showMenu, disabled: Bool; let palette: ClarificationPalette; let onAgentDecide, onCancel, onCollapse: () -> Void
    var body: some View {
        HStack(spacing: 2) {
            if showMenu {
                Menu {
                    Button("交给助手", systemImage: "sparkles", action: onAgentDecide)
                    Button("取消", systemImage: "xmark", role: .destructive, action: onCancel)
                } label: {
                    Image(systemName: "ellipsis.circle").font(.callout).foregroundStyle(palette.secondaryText)
                        .frame(width: 30, height: 30).contentShape(.rect)
                }.disabled(disabled).accessibilityLabel("更多操作")
            }
            Button(action: onCollapse) {
                Image(systemName: "chevron.down").font(.footnote.weight(.semibold)).foregroundStyle(palette.secondaryText)
                    .frame(width: 30, height: 30).contentShape(.rect)
            }.buttonStyle(.plain).accessibilityLabel("收起")
        }
    }
}

struct ClarificationCard: View {
    @Environment(\.mobileTheme) private var mobileTheme; @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let clarification: ClarificationRequest; let isSubmitting: Bool; let errorMessage: String?
    let onRespond: (String, ClarificationSubmission?) -> Void
    @State private var draft = ""; @State private var selectedID: String?
    @State private var editing = false; @State private var collapsed = false; @State private var paramsExpanded = false
    private var palette: ClarificationPalette {
        ClarificationPalette(theme: mobileTheme, dark: colorScheme == .dark)
    }

    private var trimmed: String {
        draft.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var choices: [ClarificationChoice] {
        clarification.choiceDetails ?? []
    }

    private var compose: Bool {
        editing || choices.isEmpty
    }

    var body: some View {
        if clarification.schemaVersion == 2 {
            ClarificationWizard(clarification: clarification, isSubmitting: isSubmitting, errorMessage: errorMessage, onRespond: onRespond)
                .id("\(clarification.scope ?? "").\(clarification.id).\(clarification.version)")
        } else if clarification.expiresAt != nil {
            TimelineView(.periodic(from: .now, by: 1)) { legacyBody(now: $0.date) }
        } else {
            legacyBody(now: .now)
        }
    }

    private func remainingSeconds(at date: Date) -> Int? {
        clarification.expiresAt.map { max(0, Int((Double($0) / 1000 - date.timeIntervalSince1970 - Double(clarification.clockOffset ?? 0) / 1000).rounded(.up))) }
    }

    @ViewBuilder private func legacyBody(now: Date) -> some View {
        let remaining = remainingSeconds(at: now), expired = remaining == 0, disabled = isSubmitting || expired
        if collapsed, clarification.kind != "approval" {
            ClarificationCollapsedBar(title: clarification.question, progress: nil, palette: palette, cornerRadius: mobileTheme.corner(18)) {
                MobileMotion.perform(MobileMotion.exitDuration, reduceMotion: reduceMotion) { collapsed = false }
            }
        } else if clarification.kind == "approval" {
            approvalBody(remaining: remaining, expired: expired, disabled: disabled)
        } else {
            inputBody(remaining: remaining, expired: expired, disabled: disabled)
        }
    }

    private func approvalBody(remaining: Int?, expired: Bool, disabled: Bool) -> some View {
        let approval = clarification.approval
        return ClarificationCardShell(palette: palette, cornerRadius: mobileTheme.corner(20)) {
            VStack(alignment: .leading, spacing: 14) {
                approvalHeader(operation: approval?.operation ?? clarification.question, remaining: remaining, expired: expired)
                if let operation = approval?.operation, !clarification.question.isEmpty,
                   clarification.question.trimmingCharacters(in: .whitespacesAndNewlines) != operation.trimmingCharacters(in: .whitespacesAndNewlines)
                {
                    Text(clarification.question).font(.footnote).foregroundStyle(palette.secondaryText).fixedSize(horizontal: false, vertical: true)
                }
                if let approval, approval.target != nil || approval.impact != nil || approval.preview != nil {
                    approvalDetails(approval)
                }
                if let errorMessage, !errorMessage.isEmpty {
                    Text(errorMessage).font(.caption).foregroundStyle(palette.danger)
                }
                Text("仅本次生效").font(.caption).foregroundStyle(palette.tertiaryText)
                HStack(spacing: 10) {
                    Button { clarificationHaptic(); onRespond("answer", .approval("deny")) } label: {
                        Text("拒绝").font(.subheadline.weight(.medium)).foregroundStyle(palette.tonalText)
                            .frame(maxWidth: .infinity, minHeight: 44).background(palette.tonalFill, in: .rect(cornerRadius: 12))
                    }.buttonStyle(.plain).disabled(disabled)
                    Button { clarificationHaptic(); onRespond("answer", .approval("approve")) } label: {
                        Group {
                            if isSubmitting {
                                ProgressView().tint(palette.onAccent)
                            } else {
                                Text("允许").font(.subheadline.weight(.semibold))
                            }
                        }
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
                Image(systemName: "checkmark.shield.fill").font(.callout.weight(.semibold)).foregroundStyle(palette.badgeAmberTint)
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
            if let target = approval.target, !target.isEmpty {
                approvalRow(label: "目标", value: target)
            }
            if let impact = approval.impact, !impact.isEmpty {
                if approval.target?.isEmpty == false {
                    Rectangle().fill(palette.divider).frame(height: 0.5).padding(.leading, 14)
                }
                approvalRow(label: "影响", value: impact)
            }
            if let preview = approval.preview {
                if approval.target?.isEmpty == false || approval.impact?.isEmpty == false {
                    Rectangle().fill(palette.divider).frame(height: 0.5).padding(.leading, 14)
                }
                Button { MobileMotion.perform(MobileMotion.microDuration, reduceMotion: reduceMotion) { paramsExpanded.toggle() } } label: {
                    HStack(spacing: 10) {
                        Text("参数").font(.caption).foregroundStyle(palette.tertiaryText).frame(width: 40, alignment: .leading)
                        Text(String(format: AppLocalization.resolve("%lld 项"), approval.argumentsPreview?.count ?? 0)).font(.caption).foregroundStyle(palette.secondaryText)
                        Spacer()
                        Image(systemName: "chevron.right").font(.caption2.weight(.semibold)).foregroundStyle(palette.tertiaryText)
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
                                               onCancel: { onRespond("cancel", nil) }, onCollapse: { MobileMotion.perform(MobileMotion.exitDuration, reduceMotion: reduceMotion) { collapsed = true } })
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
                                                          if compose || !draft.isEmpty {
                                                              editing = true; selectedID = choiceID
                                                          } else {
                                                              selectedID = choiceID; onRespond("answer", .input(choiceId: choiceID))
                                                          }
                                                      },
                                                      onToggleCustom: { MobileMotion.perform(MobileMotion.microDuration, reduceMotion: reduceMotion) { editing.toggle() } })
                        }
                        if compose {
                            ClarificationCustomEditor(selectedLabel: choices.first { $0.id == selectedID }?.label,
                                                      text: Binding(get: { draft }, set: {
                                                          draft = $0; if !$0.isEmpty {
                                                              editing = true
                                                          }
                                                      }),
                                                      limit: 8000, disabled: disabled, palette: palette, onClearSelection: { selectedID = nil })
                        }
                        if let errorMessage, !errorMessage.isEmpty {
                            Text(errorMessage).font(.caption).foregroundStyle(palette.danger)
                        }
                    }.padding(.horizontal, 16).padding(.bottom, 12)
                }.scrollBounceBehavior(.basedOnSize).frame(maxHeight: 320)

                if compose || isSubmitting {
                    inputFooter(canSend: canSend)
                }
            }
        }
    }

    @ViewBuilder
    private func inputFooter(canSend: Bool) -> some View {
        Rectangle().fill(palette.divider).frame(height: 0.5)
        HStack {
            Spacer()
            Button { clarificationHaptic(); onRespond("answer", .input(choiceId: selectedID, text: trimmed.isEmpty ? nil : trimmed)) } label: {
                Group {
                    if isSubmitting {
                        ProgressView().tint(palette.onAccent)
                    } else {
                        Text("发送").font(.subheadline.weight(.semibold))
                    }
                }
                .foregroundStyle(palette.onAccent).padding(.horizontal, 20).frame(minHeight: 38)
                .background(palette.accent.opacity(canSend ? 1 : 0.4), in: Capsule())
            }.buttonStyle(.plain).disabled(!canSend)
        }.padding(.horizontal, 16).padding(.vertical, 10)
    }
}
