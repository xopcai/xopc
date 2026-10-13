import Foundation

enum MarkdownTableAlignment: Equatable, Sendable {
    case leading
    case center
    case trailing
}

struct MarkdownTableCell: Equatable, Identifiable, Sendable {
    let id: UUID
    let text: String
    init(id: UUID = UUID(), text: String) {
        self.id = id; self.text = text
    }
}

struct MarkdownTableRow: Equatable, Identifiable, Sendable {
    let id: UUID
    let cells: [MarkdownTableCell]
    let isHeader: Bool

    init(cells: [String], isHeader: Bool) {
        id = UUID()
        self.cells = cells.map { MarkdownTableCell(text: $0) }
        self.isHeader = isHeader
    }

    init(id: UUID, cells: [MarkdownTableCell], isHeader: Bool) {
        self.id = id; self.cells = cells; self.isHeader = isHeader
    }
}

enum MarkdownBlock: Equatable, Sendable {
    case paragraph(String)
    case heading(level: Int, text: String)
    case bullet(level: Int, text: String)
    case numbered(number: String, level: Int, text: String)
    case quote(String)
    case code(String)
    case math(String)
    case image(alt: String, source: String)
    case table(rows: [MarkdownTableRow], alignments: [MarkdownTableAlignment])
    case divider

    // swiftlint:disable:next function_body_length
    static func parse(_ markdown: String) -> [MarkdownBlock] {
        let lines = markdown.replacingOccurrences(of: "\r\n", with: "\n")
            .split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        var blocks: [MarkdownBlock] = []
        var paragraph: [String] = []
        var code: [String] = []
        var inCode = false

        func finishParagraph() {
            guard !paragraph.isEmpty else { return }
            blocks.append(.paragraph(paragraph.joined(separator: "\n")))
            paragraph.removeAll()
        }

        var index = 0
        while index < lines.count {
            if Task.isCancelled {
                return []
            }
            let line = lines[index]
            index += 1
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if !inCode, let math = MathMarkdownSyntax.displayBlock(lines, at: index - 1)
                ?? MathMarkdownSyntax.fenceBlock(lines, at: index - 1)
            {
                finishParagraph(); blocks.append(.math(math.source)); index = math.next; continue
            }
            if trimmed.hasPrefix("```") {
                finishParagraph()
                if inCode {
                    blocks.append(.code(code.joined(separator: "\n")))
                    code.removeAll()
                }
                inCode.toggle()
                continue
            }
            if inCode {
                code.append(line)
                continue
            }
            if trimmed.isEmpty {
                finishParagraph()
                continue
            }
            if let structured = structuredBlocks(lines: lines, index: index, trimmed: trimmed) {
                finishParagraph()
                blocks.append(contentsOf: structured.blocks)
                index = structured.nextIndex
                continue
            }
            let indentation = line.prefix { $0 == " " }.count
            let level = min(indentation / 2, 3)
            if let standalone = standaloneBlock(from: trimmed, level: level) {
                finishParagraph()
                blocks.append(standalone)
                continue
            }
            paragraph.append(trimmed)
        }
        finishParagraph()
        if inCode {
            blocks.append(.code(code.joined(separator: "\n")))
        }
        return blocks
    }

    private static func structuredBlocks(lines: [String], index: Int, trimmed: String)
        -> (blocks: [MarkdownBlock], nextIndex: Int)?
    {
        if let table = parseTable(lines: lines, headerIndex: index - 1) {
            return ([table.block], table.nextIndex)
        }
        if let images = imageBlocks(from: trimmed) {
            return (images, index)
        }
        return nil
    }

    private static func standaloneBlock(from line: String, level: Int) -> MarkdownBlock? {
        if ["---", "***", "___"].contains(line) {
            return .divider
        }
        if let heading = heading(from: line) {
            return heading
        }
        if let bullet = bullet(from: line, level: level) {
            return bullet
        }
        if let numbered = numbered(from: line, level: level) {
            return numbered
        }
        if line.hasPrefix(">") {
            return .quote(String(line.dropFirst()).trimmingCharacters(in: .whitespaces))
        }
        return nil
    }

    private static func heading(from line: String) -> MarkdownBlock? {
        let marks = line.prefix { $0 == "#" }.count
        guard (1 ... 6).contains(marks), line.dropFirst(marks).hasPrefix(" ") else { return nil }
        let text = line.dropFirst(marks + 1).trimmingCharacters(in: .whitespaces)
        return text.isEmpty ? nil : .heading(level: marks, text: text)
    }

    private static func bullet(from line: String, level: Int) -> MarkdownBlock? {
        guard let first = line.first, "-*+".contains(first), line.dropFirst().hasPrefix(" ") else { return nil }
        let text = line.dropFirst(2).trimmingCharacters(in: .whitespaces)
        return text.isEmpty ? nil : .bullet(level: level, text: text)
    }

    private static func numbered(from line: String, level: Int) -> MarkdownBlock? {
        let digits = line.prefix { $0.isNumber }
        guard !digits.isEmpty, digits.count < 5 else { return nil }
        let rest = line.dropFirst(digits.count)
        guard rest.hasPrefix(". ") || rest.hasPrefix(") ") else { return nil }
        let text = rest.dropFirst(2).trimmingCharacters(in: .whitespaces)
        return text.isEmpty ? nil : .numbered(number: String(digits), level: level, text: text)
    }

    private static func parseTable(lines: [String], headerIndex: Int) -> (block: MarkdownBlock, nextIndex: Int)? {
        let line = lines[headerIndex]
        guard line.contains("|"), headerIndex + 1 < lines.count else { return nil }
        let headers = tableCells(line)
        let separators = tableCells(lines[headerIndex + 1])
        guard headers.count == separators.count,
              separators.allSatisfy({ $0.range(of: #"^:?-{3,}:?$"#, options: .regularExpression) != nil })
        else { return nil }

        let alignments = separators.map { separator -> MarkdownTableAlignment in
            if separator.hasPrefix(":"), separator.hasSuffix(":") {
                return .center
            }
            return separator.hasSuffix(":") ? .trailing : .leading
        }
        var rows = [MarkdownTableRow(cells: headers, isHeader: true)]
        var index = headerIndex + 2
        while index < lines.count, !lines[index].trimmingCharacters(in: .whitespaces).isEmpty,
              lines[index].contains("|")
        {
            let cells = tableCells(lines[index])
            rows.append(MarkdownTableRow(cells: headers.indices.map { $0 < cells.count ? cells[$0] : "" }, isHeader: false))
            index += 1
        }
        return (.table(rows: rows, alignments: alignments), index)
    }

    private static func imageBlocks(from line: String) -> [MarkdownBlock]? {
        guard let pattern = try? NSRegularExpression(pattern: #"!\[([^\]]*)\]\(([^\s)]+)\)"#) else { return nil }
        let string = line as NSString
        let matches = pattern.matches(in: line, range: NSRange(location: 0, length: string.length))
        guard !matches.isEmpty else { return nil }
        var blocks: [MarkdownBlock] = []
        var cursor = 0
        for match in matches {
            let before = string.substring(with: NSRange(location: cursor, length: match.range.location - cursor))
                .trimmingCharacters(in: .whitespaces)
            if !before.isEmpty {
                blocks.append(.paragraph(before))
            }
            blocks.append(.image(
                alt: string.substring(with: match.range(at: 1)),
                source: string.substring(with: match.range(at: 2))
            ))
            cursor = NSMaxRange(match.range)
        }
        let after = string.substring(from: cursor).trimmingCharacters(in: .whitespaces)
        if !after.isEmpty {
            blocks.append(.paragraph(after))
        }
        return blocks
    }

    private static func tableCells(_ line: String) -> [String] {
        var source = line.trimmingCharacters(in: .whitespaces)
        if source.hasPrefix("|") {
            source.removeFirst()
        }
        if source.hasSuffix("|"), !source.hasSuffix(#"\|"#) {
            source.removeLast()
        }
        var cells: [String] = []
        var cell = ""
        var codeTicks = 0
        let characters = Array(source)
        var index = 0
        while index < characters.count {
            let character = characters[index]
            if character == "\\", index + 1 < characters.count, characters[index + 1] == "|" {
                cell.append("|")
                index += 2
                continue
            }
            if character == "`" {
                var end = index
                while end < characters.count, characters[end] == "`" {
                    end += 1
                }
                let count = end - index
                codeTicks = codeTicks == 0 ? count : (codeTicks == count ? 0 : codeTicks)
                cell += String(repeating: "`", count: count)
                index = end
                continue
            }
            if character == "|", codeTicks == 0 {
                cells.append(cell.trimmingCharacters(in: .whitespaces))
                cell = ""
            } else {
                cell.append(character)
            }
            index += 1
        }
        cells.append(cell.trimmingCharacters(in: .whitespaces))
        return cells
    }
}

struct MarkdownPart: Equatable, Identifiable, Sendable {
    let id: UUID
    let block: MarkdownBlock

    init(_ block: MarkdownBlock) {
        self.init(block, id: UUID())
    }

    init(_ block: MarkdownBlock, id: UUID) {
        self.id = id
        self.block = block
    }

    static func project(_ blocks: [MarkdownBlock], previous: [MarkdownPart]) -> [MarkdownPart] {
        blocks.enumerated().map { index, block in
            guard index < previous.count else { return MarkdownPart(block) }
            let retained = previous[index]
            let normalized = reconcileTable(block, previous: retained.block)
            return normalized == retained.block ? retained : MarkdownPart(normalized, id: retained.id)
        }
    }

    private static func reconcileTable(_ block: MarkdownBlock, previous: MarkdownBlock) -> MarkdownBlock {
        guard case let .table(rows, alignments) = block,
              case let .table(oldRows, _) = previous else { return block }
        let normalized = rows.enumerated().map { index, row in
            guard index < oldRows.count else { return row }
            let old = oldRows[index]
            let cells = row.cells.enumerated().map { column, cell in
                MarkdownTableCell(id: column < old.cells.count ? old.cells[column].id : cell.id, text: cell.text)
            }
            return MarkdownTableRow(id: old.id, cells: cells, isHeader: row.isHeader)
        }
        return .table(rows: normalized, alignments: alignments)
    }
}
