import Testing
@testable import XopcMobile

struct MarkdownBlocksTests {
    @Test func keepsSoftLineBreaksWithinParagraphs() {
        #expect(MarkdownBlock.parse("first line\nsecond line") == [.paragraph("first line\nsecond line")])
    }

    @Test func extractsInlineImagesWithoutDroppingSurroundingText() {
        #expect(MarkdownBlock.parse("Before ![chart](https://example.com/chart.png) after") == [
            .paragraph("Before"),
            .image(alt: "chart", source: "https://example.com/chart.png"),
            .paragraph("after")
        ])
        #expect(MarkdownBlock.parse("![diagram](media://messages/image.png)") == [
            .image(alt: "diagram", source: "media://messages/image.png")
        ])
    }

    @Test func tablesKeepEscapedAndCodePipesInsideCells() {
        let blocks = MarkdownBlock.parse("""
        Intro

        | Name | Count | Detail |
        | :--- | ---: | :---: |
        | A\\|B | 2 | `x|y` |
        | C | 3 | Done |

        End
        """)

        #expect(blocks.count == 3)
        #expect(blocks[0] == .paragraph("Intro"))
        #expect(blocks[2] == .paragraph("End"))
        guard case let .table(rows, alignments) = blocks[1] else {
            Issue.record("Expected a table block")
            return
        }
        #expect(alignments == [.leading, .trailing, .center])
        #expect(rows.map(\.isHeader) == [true, false, false])
        #expect(rows.map { $0.cells.map(\.text) } == [
            ["Name", "Count", "Detail"],
            ["A|B", "2", "`x|y`"],
            ["C", "3", "Done"]
        ])
        #expect(Set(rows.map(\.id)).count == rows.count)
        #expect(rows.allSatisfy { Set($0.cells.map(\.id)).count == $0.cells.count })
    }
}
