import Foundation
import Testing
@testable import XopcMobile

struct ChatReplySpaceTests {
    @Test func reservesOnlyForFollowersAndConsumesBeforeScrolling() {
        var space = ChatReplySpace()
        space.begin(anchorID: "user", availableHeight: 600, following: false)
        #expect(space.anchorID == nil)
        #expect(space.remaining == 0)
        space.begin(anchorID: "user", availableHeight: 600, following: true)
        #expect(space.remaining == 60)
        space.consume(replyHeight: 20, availableHeight: 600, following: true)
        #expect(space.remaining == 40)
        space.consume(replyHeight: 240, availableHeight: 240, following: false)
        #expect(space.remaining == 40)
        space.consume(replyHeight: 20, availableHeight: 300, following: true)
        #expect(space.remaining == 10)
        space.consume(replyHeight: 40, availableHeight: 600, following: true)
        #expect(space.remaining == 10)
        space.consume(replyHeight: 240, availableHeight: 600, following: true)
        #expect(space.remaining == 0)
    }

    @Test func nextSendRenewsSpaceAndConversationResetClearsIt() {
        var space = ChatReplySpace()
        space.begin(anchorID: "first", availableHeight: 600, following: true)
        space.consume(replyHeight: 20, availableHeight: 600, following: true)
        space.reanchor("confirmed-first")
        #expect(space.anchorID == "confirmed-first")
        #expect(space.remaining == 40)
        space.begin(anchorID: "second", availableHeight: 450, following: true)
        #expect(space.anchorID == "second")
        #expect(space.remaining == 45)
        space.begin(anchorID: "large", availableHeight: 1600, following: true)
        #expect(space.remaining == 64)
        space.begin(anchorID: "keyboard", availableHeight: 200, following: true)
        #expect(space.remaining == 20)
        space = ChatReplySpace()
        #expect(space.remaining == 0)
        #expect(space.anchorID == nil)
    }
}
