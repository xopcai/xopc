import ImageIO
import SwiftDraw
import SwiftUI

private final class CapabilityLogoRedirectPolicy: NSObject, URLSessionTaskDelegate {
    func urlSession(_: URLSession, task _: URLSessionTask, willPerformHTTPRedirection _: HTTPURLResponse,
                    newRequest _: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void)
    {
        completionHandler(nil)
    }
}

private enum CapabilityLogoLoader {
    private static let limit = 512 * 1024
    private static let session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 8
        config.timeoutIntervalForResource = 12
        return URLSession(configuration: config, delegate: CapabilityLogoRedirectPolicy(), delegateQueue: nil)
    }()

    static func source(_ reference: String?, origin: URL) -> String? {
        guard let reference, !reference.isEmpty else { return nil }
        if reference.utf8.count <= 176_000,
           reference.range(of: #"^data:image/(svg\+xml|png|webp);base64,"#, options: .regularExpression) != nil
        {
            return reference
        }
        if reference.range(of: #"^/(connector-icons|channel-icons)/[a-z0-9_%.-]+(/[a-z0-9_%.-]+)?$"#,
                           options: [.regularExpression, .caseInsensitive]) != nil,
            !reference.contains(".."),
           reference.range(of: #"%(2e|2f|5c)"#, options: [.regularExpression, .caseInsensitive]) == nil
        {
            return URL(string: reference, relativeTo: origin)?.absoluteURL.absoluteString
        }
        guard reference.utf8.count <= 2048, !reference.contains("\\"),
              let url = URL(string: reference), url.scheme?.lowercased() == "https",
              url.host != nil, url.user == nil, url.password == nil else { return nil }
        return url.absoluteString
    }

    static func image(_ source: String) async -> UIImage? {
        let data: Data
        if source.hasPrefix("data:") {
            guard let comma = source.firstIndex(of: ","),
                  let decoded = Data(base64Encoded: String(source[source.index(after: comma)...])) else { return nil }
            data = decoded
        } else {
            guard let url = URL(string: source), let bytes = try? await fetch(url) else { return nil }
            data = bytes
        }
        guard !Task.isCancelled else { return nil }
        if let text = String(data: data, encoding: .utf8),
           text.range(of: #"<svg[\s>]"#, options: [.regularExpression, .caseInsensitive]) != nil
        {
            guard text.range(of: #"<!\s*(DOCTYPE|ENTITY)\b"#, options: [.regularExpression, .caseInsensitive]) == nil else { return nil }
            // SVG defaults a gradient stop's offset to zero. SwiftDraw requires an explicit value.
            let normalized = text.replacingOccurrences(of: #"(<stop\b)(?![^>]*\boffset\s*=)"#,
                                                       with: #"$1 offset="0""#, options: [.regularExpression, .caseInsensitive])
            guard let svg = SwiftDraw.Image(data: Data(normalized.utf8)),
                  svg.size.width.isFinite, svg.size.height.isFinite, svg.size.width > 0, svg.size.height > 0 else { return nil }
            let scale = 48 / max(svg.size.width, svg.size.height)
            return svg.rasterize(with: CGSize(width: max(1, svg.size.width * scale), height: max(1, svg.size.height * scale)))
        }
        guard let imageSource = CGImageSourceCreateWithData(data as CFData, nil),
              let thumbnail = CGImageSourceCreateThumbnailAtIndex(imageSource, 0, [
                  kCGImageSourceCreateThumbnailFromImageAlways: true,
                  kCGImageSourceCreateThumbnailWithTransform: true,
                  kCGImageSourceThumbnailMaxPixelSize: 144
              ] as CFDictionary) else { return nil }
        return UIImage(cgImage: thumbnail)
    }

    private static func fetch(_ url: URL) async throws -> Data? {
        let (stream, response) = try await session.bytes(from: url)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200,
              response.expectedContentLength <= limit else { return nil }
        var data = Data()
        for try await byte in stream {
            guard data.count < limit else { return nil }
            data.append(byte)
        }
        return data
    }
}

struct CapabilityLogo: View {
    let reference: String?
    let origin: URL
    let label: String
    let symbol: String
    var extent: CGFloat = 48

    @Environment(\.mobileTheme) private var theme
    @Environment(\.colorScheme) private var colorScheme
    @State private var artwork: UIImage?
    private static let cache: NSCache<NSString, UIImage> = {
        let cache = NSCache<NSString, UIImage>()
        cache.countLimit = 96
        return cache
    }()

    var body: some View {
        let source = CapabilityLogoLoader.source(reference, origin: origin)
        Group {
            if let artwork {
                SwiftUI.Image(uiImage: artwork).resizable().scaledToFit()
                    .frame(width: extent * 0.65, height: extent * 0.65)
            } else if let initials {
                Text(verbatim: initials).font(.system(size: extent * 0.39, weight: .medium))
            } else {
                SwiftUI.Image(systemName: symbol).font(.system(size: extent * 0.43))
            }
        }
        .foregroundStyle(theme.action)
        .frame(width: extent, height: extent)
        .background(artwork == nil ? theme.active : (colorScheme == .dark ? MobileTheme().grouped : theme.grouped),
                    in: .rect(cornerRadius: theme.corner(14)))
        .accessibilityHidden(true)
        .task(id: source) {
            artwork = source.flatMap { Self.cache.object(forKey: $0 as NSString) }
            guard let source, artwork == nil, let image = await CapabilityLogoLoader.image(source), !Task.isCancelled else { return }
            Self.cache.setObject(image, forKey: source as NSString)
            artwork = image
        }
    }

    private var initials: String? {
        let word = label.trimmingCharacters(in: .whitespacesAndNewlines)
        if let range = word.range(of: #"^[A-Za-z0-9]{1,2}"#, options: .regularExpression) {
            return word[range].uppercased()
        }
        return word.first.map(String.init)
    }
}
