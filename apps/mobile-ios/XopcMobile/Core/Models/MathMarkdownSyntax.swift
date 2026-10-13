import Foundation

enum MathMarkdownSyntax {
    static func candidateCount(_ source: String) -> Int {
        let pattern = #"\\[\(\[]|\$\$|\$(?=[^\s$])|(?:`{3,}|~{3,})math\b"#
        return (try? NSRegularExpression(pattern: pattern))?.numberOfMatches(in: source, range: NSRange(source.startIndex..., in: source)) ?? 0
    }

    static func candidateCount(_ block: MarkdownBlock) -> Int {
        switch block {
        case let .paragraph(text), let .heading(_, text), let .bullet(_, text), let .numbered(_, _, text), let .quote(text), let .math(text):
            candidateCount(text)
        case let .table(rows, _): rows.reduce(0) { sum, row in sum + row.cells.reduce(0) { $0 + candidateCount($1.text) } }
        default: 0
        }
    }

    static func mayContainMath(_ source: String) -> Bool {
        source.contains("\\(") || source.contains("\\[") || source.contains("$$") ||
            source.range(of: #"\$[^\s$][^\n]*\$"#, options: .regularExpression) != nil
    }

    static func fenceBlock(_ lines: [String], at start: Int) -> (source: String, next: Int)? {
        let first = lines[start].trimmingCharacters(in: .whitespaces)
        let marker = String(first.prefix(while: { $0 == "`" || $0 == "~" }))
        guard marker.count >= 3, Set(marker).count == 1,
              lines[start].prefix(while: { $0 == " " }).count < 4,
              first.dropFirst(marker.count).trimmingCharacters(in: .whitespaces) == "math" else { return nil }
        var source = lines[start]
        var next = start + 1
        while next < lines.count {
            let line = lines[next]
            source += "\n" + line; next += 1
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.count >= marker.count, trimmed.allSatisfy({ $0 == marker.first }),
               line.prefix(while: { $0 == " " }).count < 4
            {
                break
            }
        }
        return (source, next)
    }

    static func displayBlock(_ lines: [String], at start: Int) -> (source: String, next: Int)? {
        let pattern = #"^( {0,3}(?:> ?)*(?:(?:[-+*]|\d+[.)]) +)?)(\\\[|\$\$)"#
        guard let opening = lines[start].range(of: pattern, options: .regularExpression) else { return nil }
        let width = lines[start].distance(from: lines[start].startIndex, to: opening.upperBound) - 2
        let prefix = String(lines[start].prefix(width))
        let listed = prefix.range(of: #"(?:[-+*]|\d+[.)]) +$"#, options: .regularExpression) != nil
        let line = String(lines[start].dropFirst(width))
        let closer = line.hasPrefix("\\[") ? "\\]" : "$$"
        if closingOffset(line, closer: closer) != nil, !closed(line, closer: closer) {
            return nil
        }
        var source = lines[start]
        var logical = line
        var next = start + 1
        while !closed(logical, closer: closer), next < lines.count {
            let continuation = lines[next]
            if prefix.contains(">"), continuation.range(of: #"^ {0,3}>"#, options: .regularExpression) == nil {
                break
            }
            if !prefix.contains(">"), listed,
               !continuation.trimmingCharacters(in: .whitespaces).isEmpty,
               continuation.prefix(while: { $0 == " " }).count < width
            {
                break
            }
            source += "\n" + lines[next]
            logical += "\n" + continuation.replacingOccurrences(of: #"^ {0,3}(?:> ?)*"#, with: "", options: .regularExpression)
                .trimmingCharacters(in: .whitespaces)
            next += 1
        }
        return (source, next)
    }

    static func closed(_ source: String, closer: String) -> Bool {
        let chars = Array(source)
        guard let offset = closingOffset(source, closer: closer) else { return false }
        return String(chars.dropFirst(offset + 2)).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private static func closingOffset(_ source: String, closer: String) -> Int? {
        let chars = Array(source)
        var comment = false
        var slashes = 0
        for index in 2 ..< max(2, chars.count) {
            let char = chars[index]
            if char == "\n" {
                comment = false
            }
            if char == "%", slashes % 2 == 0 {
                comment = true
            }
            if !comment, slashes % 2 == 0, index + 1 < chars.count,
               chars[index] == closer.first, chars[index + 1] == closer.last
            {
                return index
            }
            slashes = char == "\\" ? slashes + 1 : 0
        }
        return nil
    }
}
