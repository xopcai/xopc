import SwiftUI

@main
struct XopcMobileApp: App {
    init() {
#if DEBUG
        if ProcessInfo.processInfo.environment["XOPC_UI_TEST_RESET_NAVIGATION"] == "1" {
            let defaults = UserDefaults.standard
            for key in defaults.dictionaryRepresentation().keys where key.hasPrefix("navigation.") {
                defaults.removeObject(forKey: key)
            }
        }
#endif
        if let language = ProcessInfo.processInfo.environment["XOPC_UI_TEST_LANGUAGE"] {
            UserDefaults.standard.set(language, forKey: "app.language")
        }
    }

    var body: some Scene {
        WindowGroup {
            AppRootView()
        }
    }
}
