struct RunStreamEvent: Equatable, Sendable {
    let name: String
    let sequence: Int
    let messageId: String?
    let delta: String?
    let offset: Int?
    let status: String?
    let errorMessage: String?
    let toolName: String?
    let stage: String?
    var presentation: String?

    var isTerminal: Bool {
        name == "run_end" || name == "error"
    }
}

struct ExecutionActivityItem: Equatable, Identifiable, Sendable {
    let id: String
    let title: String
    var status: String
}

struct RealtimeTicket: Decodable, Sendable {
    let ticket: String
    let realtime: RealtimeCompatibility
}

struct RealtimeCompatibility: Decodable, Sendable {
    let minVersion: Int
    let maxVersion: Int
    let capabilities: [String]
}
