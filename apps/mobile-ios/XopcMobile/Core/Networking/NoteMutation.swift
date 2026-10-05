import Foundation

struct NoteMutation: Encodable {
    let title: String
    let markdown: String
    let kind: String
    let platform: String
    let projectId: String?
    let channel = "app"
}
