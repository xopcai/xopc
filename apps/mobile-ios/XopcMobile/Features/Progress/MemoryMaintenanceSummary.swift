import Foundation

struct MemoryMaintenanceSummary {
    struct Metric: Identifiable {
        let key: String
        let label: String
        let count: Int

        var id: String {
            key
        }
    }

    let metrics: [Metric]

    init?(_ summary: String) {
        let prefix = "Memory maintenance completed:"
        guard summary.hasPrefix(prefix) else { return nil }
        let json = summary.dropFirst(prefix.count).trimmingCharacters(in: .whitespacesAndNewlines)
        guard let data = json.data(using: .utf8),
              let values = try? JSONSerialization.jsonObject(with: data) as? [String: Int]
        else { return nil }

        let labels = [
            ("scanned", "已扫描"),
            ("stale", "已过期"),
            ("needsReview", "待复核"),
            ("activated", "已激活"),
            ("expiredPriorities", "过期优先级"),
            ("expiredObservations", "过期观察"),
            ("archived", "已归档"),
            ("repairedIndexes", "已修复索引")
        ]
        metrics = labels.compactMap { key, label in
            values[key].map { Metric(key: key, label: label, count: $0) }
        }
        guard !metrics.isEmpty else { return nil }
    }
}
