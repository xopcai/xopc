import SwiftUI
import UIKit

struct ChatSelectableText: UIViewRepresentable {
    let message: TimelineMessage
    let onDismiss: () -> Void
    @Environment(\.mobileTheme) private var mobileTheme
    @Environment(\.locale) private var locale
    @ScaledMetric(relativeTo: .body) private var fontSize = MobileTextStyle.body.size

    func makeUIView(context _: Context) -> ChatSelectionTextView {
        let view = ChatSelectionTextView()
        view.accessibilityIdentifier = "chat-inline-text-selection"
        view.backgroundColor = .clear
        view.isEditable = false
        view.isSelectable = true
        view.isScrollEnabled = false
        view.textContainerInset = .zero
        view.textContainer.lineFragmentPadding = 0
        view.setContentCompressionResistancePriority(.required, for: .vertical)
        return view
    }

    func updateUIView(_ view: ChatSelectionTextView, context _: Context) {
        view.onDismiss = onDismiss
        view.locale = locale
        view.tintColor = UIColor(mobileTheme.action)
        if view.source != message.text || view.renderedFontSize != fontSize {
            view.source = message.text
            view.renderedFontSize = fontSize
            view.attributedText = formattedText(color: UIColor(mobileTheme.foreground))
        }
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: ChatSelectionTextView, context _: Context) -> CGSize? {
        guard let width = proposal.width, width > 0 else { return nil }
        return uiView.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude))
    }

    private func formattedText(color: UIColor) -> NSAttributedString {
        let result = NSMutableAttributedString()
        let parsed = message.markdownParts.isEmpty ? MarkdownBlock.parse(message.text) : message.markdownParts.map(\.block)
        for (index, block) in parsed.enumerated() {
            if index + 1 < parsed.count, MarkdownBlock.redundantImageLink(block, followedBy: parsed[index + 1]) {
                continue
            }
            if result.length > 0 { result.append(NSAttributedString(string: "\n")) }
            result.append(formattedBlock(block, color: color))
        }
        if result.string.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            result.setAttributedString(NSAttributedString(string: message.text, attributes: [
                .font: UIFont.systemFont(ofSize: fontSize), .foregroundColor: color
            ]))
        }
        return result
    }

    private func formattedBlock(_ block: MarkdownBlock, color: UIColor) -> NSAttributedString {
        var text: String
        var size = fontSize
        var weight: UIFont.Weight = .regular
        var monospaced = false
        switch block {
        case let .paragraph(source), let .quote(source): text = source
        case let .heading(level, source):
            text = source
            size += level == 1 ? 4 : level == 2 ? 2 : 0
            weight = .semibold
        case let .bullet(level, source):
            text = String(repeating: "  ", count: min(max(level, 0), 3)) + "• " + source
        case let .numbered(number, level, source):
            text = String(repeating: "  ", count: min(max(level, 0), 3)) + "\(number). " + source
        case let .code(source), let .math(source), let .chart(source, _):
            text = source
            monospaced = true
        case let .image(alt, _): text = alt
        case let .table(rows, _):
            text = rows.map { $0.cells.map(\.text).joined(separator: "  ") }.joined(separator: "\n")
        case .divider: return NSAttributedString(string: "")
        }

        let parsed = monospaced ? AttributedString(text) :
            (try? AttributedString(markdown: text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)))
            ?? AttributedString(text)
        let result = NSMutableAttributedString()
        let paragraph = NSMutableParagraphStyle()
        paragraph.minimumLineHeight = size + 7
        for run in parsed.runs {
            let intent = run.inlinePresentationIntent ?? []
            let code = monospaced || intent.contains(.code)
            var font = code ? UIFont.monospacedSystemFont(ofSize: size, weight: weight)
                : UIFont.systemFont(ofSize: size, weight: intent.contains(.stronglyEmphasized) ? .semibold : weight)
            if intent.contains(.emphasized),
               let descriptor = font.fontDescriptor.withSymbolicTraits(font.fontDescriptor.symbolicTraits.union(.traitItalic))
            {
                font = UIFont(descriptor: descriptor, size: size)
            }
            var attributes: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: color, .paragraphStyle: paragraph]
            if run.link != nil { attributes[.underlineStyle] = NSUnderlineStyle.single.rawValue }
            if intent.contains(.strikethrough) { attributes[.strikethroughStyle] = NSUnderlineStyle.single.rawValue }
            result.append(NSAttributedString(string: String(parsed[run.range].characters), attributes: attributes))
        }
        return result
    }
}

final class ChatSelectionTextView: UITextView, UITextViewDelegate, @preconcurrency UIEditMenuInteractionDelegate {
    var source: String?
    var renderedFontSize: CGFloat?
    var locale = Locale.current
    var onDismiss: () -> Void = {}

    private lazy var initialMenu = UIEditMenuInteraction(delegate: self)
    private var didStartSelection = false
    private var didScheduleSelection = false

    override func layoutSubviews() {
        super.layoutSubviews()
        guard !didScheduleSelection, bounds.width > 0, window != nil, !text.isEmpty else { return }
        didScheduleSelection = true
        delegate = self
        addInteraction(initialMenu)
        Task { @MainActor [weak self] in self?.startSelection() }
    }

    private func startSelection() {
        guard let window, becomeFirstResponder() else { return }
        var visible = bounds.intersection(convert(window.bounds, from: window))
        var parent = superview
        while let ancestor = parent {
            if ancestor.clipsToBounds { visible = visible.intersection(convert(ancestor.bounds, from: ancestor)) }
            parent = ancestor.superview
        }
        let point = visible.isNull ? CGPoint(x: 0, y: 8) : CGPoint(x: visible.minX + 2, y: visible.minY + 8)
        let position = closestPosition(to: point) ?? beginningOfDocument
        let range = tokenizer.rangeEnclosingPosition(position, with: .word, inDirection: .storage(.forward))
            ?? characterRange(byExtending: position, in: .right)
            ?? characterRange(byExtending: position, in: .left)
        selectedTextRange = range
        guard selectedRange.length > 0 else { return }
        didStartSelection = true
        initialMenu.presentEditMenu(with: UIEditMenuConfiguration(identifier: nil, sourcePoint: point))
    }

    func editMenuInteraction(_: UIEditMenuInteraction, menuFor _: UIEditMenuConfiguration,
                             suggestedActions _: [UIMenuElement]) -> UIMenu? {
        selectionMenu()
    }

    func editMenuInteraction(_: UIEditMenuInteraction, targetRectFor _: UIEditMenuConfiguration) -> CGRect {
        selectedTextRange.map { firstRect(for: $0) } ?? .null
    }

    func textView(_: UITextView, editMenuForTextIn _: NSRange, suggestedActions _: [UIMenuElement]) -> UIMenu? {
        selectionMenu()
    }

    func textViewDidChangeSelection(_: UITextView) {
        if didStartSelection && selectedRange.length == 0 {
            initialMenu.dismissMenu()
            onDismiss()
        }
    }

    override func resignFirstResponder() -> Bool {
        let resigned = super.resignFirstResponder()
        if resigned && didStartSelection {
            didStartSelection = false
            Task { @MainActor [weak self] in self?.onDismiss() }
        }
        return resigned
    }

    private func selectionMenu() -> UIMenu? {
        guard let range = selectedTextRange, let selected = text(in: range), !selected.isEmpty else { return nil }
        let copy = UIAction(title: AppLocalization.string("复制", locale: locale), image: UIImage(systemName: "doc.on.doc")) { [weak self] _ in
            UIPasteboard.general.string = selected
            self?.onDismiss()
        }
        let selectAll = UIAction(title: AppLocalization.string("全选", locale: locale), image: UIImage(systemName: "checkmark.square")) { [weak self] _ in
            guard let self else { return }
            selectedRange = NSRange(location: 0, length: (text as NSString).length)
            initialMenu.reloadVisibleMenu()
        }
        let share = UIAction(title: AppLocalization.string("分享", locale: locale), image: UIImage(systemName: "square.and.arrow.up")) { [weak self] _ in
            self?.share(selected)
        }
        return UIMenu(children: selected == text ? [copy, share] : [copy, selectAll, share])
    }

    private func share(_ selected: String) {
        guard let scene = window?.windowScene,
              var presenter = scene.keyWindow?.rootViewController else { return }
        while let presented = presenter.presentedViewController { presenter = presented }
        let activity = UIActivityViewController(activityItems: [selected], applicationActivities: nil)
        activity.popoverPresentationController?.sourceView = self
        activity.popoverPresentationController?.sourceRect = selectedTextRange.map { firstRect(for: $0) } ?? bounds
        presenter.present(activity, animated: true)
    }
}
