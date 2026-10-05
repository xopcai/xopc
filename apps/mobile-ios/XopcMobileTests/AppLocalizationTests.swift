import Foundation
import Testing
@testable import XopcMobile

struct AppLocalizationTests {
    @Test func assistantDynamicTitlesResolveInEnglish() {
        let english = Locale(identifier: "en")

        #expect(AppLocalization.resolve(RealtimeVoiceMode.natural.title, locale: english) == "Live Voice")
        #expect(AppLocalization.resolve(RealtimeVoiceMode.assistant.title, locale: english) == "Voice Assistant")
        #expect(AppLocalization.resolve(ContextReferenceKind.note.title, locale: english) == "Notes")
        #expect(AppLocalization.resolve(ContextReferenceKind.task.title, locale: english) == "Tasks")
        #expect(AppLocalization.resolve(ContextReferenceKind.file.title, locale: english) == "Files")
    }
}
