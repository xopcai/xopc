import Foundation

enum FileTransferLimit {
    static let uploadBytes = 8 * 1024 * 1024
    static let downloadBytes = 16 * 1024 * 1024
}

enum FileUploadName {
    static func isValid(_ name: String) -> Bool {
        !name.isEmpty && name == name.trimmingCharacters(in: .whitespacesAndNewlines)
            && name != "." && name != ".."
            && !name.contains("/") && !name.contains("\\")
            && !name.contains("\n") && !name.contains("\r")
    }

    static func suggestedAlternative(to name: String) -> String {
        let extensionStart = name.lastIndex(of: ".")
        guard let extensionStart, extensionStart != name.startIndex else { return "\(name) (1)" }
        return "\(name[..<extensionStart]) (1)\(name[extensionStart...])"
    }
}

enum FileUploadFailureMessage {
    static func resolve(_ error: Error) -> String {
        if let gatewayError = error as? GatewayClientError,
           case let .http(statusCode, _) = gatewayError,
           statusCode == 408 || statusCode == 429 || statusCode >= 500
        {
            return AppLocalization.string("上传暂时失败，请检查网络后重试。", locale: AppLocalization.selectedLocale)
        }
        if error is URLError {
            return AppLocalization.string("上传暂时失败，请检查网络后重试。", locale: AppLocalization.selectedLocale)
        }
        return error.localizedDescription
    }
}

enum FileTransferError: LocalizedError {
    case tooLargeForUpload
    case tooLargeForDownload

    var errorDescription: String? {
        switch self {
        case .tooLargeForUpload: AppLocalization.string("上传文件不能超过 8 MiB", locale: AppLocalization.selectedLocale)
        case .tooLargeForDownload: AppLocalization.string("下载文件不能超过 16 MiB", locale: AppLocalization.selectedLocale)
        }
    }
}
