import CoreLocation
import UIKit

@MainActor
final class DeviceLocation: NSObject, @preconcurrency CLLocationManagerDelegate {
    static let shared = DeviceLocation()
    private let manager = CLLocationManager()
    private var pending: CheckedContinuation<Data, Error>?
    private var consent: UIAlertController?
    private var timeout: Task<Void, Never>?
    private var requestedPrecision = "approximate"
    private var approved = false
    private var pendingId: UUID?

    override private init() {
        super.init(); manager.delegate = self
        NotificationCenter.default.addObserver(self, selector: #selector(backgrounded), name: UIApplication.didEnterBackgroundNotification, object: nil)
    }
    @objc private func backgrounded() { finish(.failure(LocationFailure(code: "ENDPOINT_NOT_FOREGROUND"))) }
    func acquire(purpose: String, precision: String, deadline: Double) async throws -> Data {
        guard pending == nil else { throw LocationFailure(code: "TOOL_BUSY") }
        guard UIApplication.shared.applicationState == .active else { throw LocationFailure(code: "ENDPOINT_NOT_FOREGROUND") }
        let requestId = UUID()
        requestedPrecision = precision; approved = false
        return try await withTaskCancellationHandler(operation: {
            try Task.checkCancellation()
            return try await withCheckedThrowingContinuation { continuation in
                pending = continuation; pendingId = requestId
                let remaining = max(0, min(90_000, deadline - Date().timeIntervalSince1970 * 1000))
                timeout = Task { [weak self] in
                    do { try await Task.sleep(for: .milliseconds(remaining)); self?.finish(.failure(LocationFailure(code: "TOOL_TIMEOUT"))) }
                    catch {}
                }
                let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first { $0.activationState == .foregroundActive }
                var presenter = scene?.windows.first { $0.isKeyWindow }?.rootViewController
                while let presented = presenter?.presentedViewController { presenter = presented }
                guard let presenter else { finish(.failure(LocationFailure(code: "ENDPOINT_NOT_FOREGROUND"))); return }
                let service = purpose == "weather" ? "Open-Meteo" : "OpenStreetMap"
                let dialog = UIAlertController(title: "允许本次使用位置？", message: "使用此手机的\(precision == "precise" ? "精确" : "大致")位置\(purpose == "weather" ? "查询天气" : "查询附近地点")。坐标将发送给 \(service)，仅用于本次查询，原始坐标不进入聊天历史。", preferredStyle: .alert)
                dialog.addAction(UIAlertAction(title: "拒绝", style: .cancel) { [weak self] _ in guard self?.pendingId == requestId else { return }; self?.finish(.failure(LocationFailure(code: "USER_DENIED"))) })
                dialog.addAction(UIAlertAction(title: "允许一次", style: .default) { [weak self] _ in guard self?.pendingId == requestId else { return }; self?.approved = true; self?.startLocation() })
                consent = dialog; presenter.present(dialog, animated: true)
            }
        }, onCancel: { Task { @MainActor in DeviceLocation.shared.cancel(requestId) } })
    }
    private func cancel(_ id: UUID) { if pendingId == id { finish(.failure(LocationFailure(code: "TOOL_CANCELLED"))) } }
    private func startLocation() {
        guard pending != nil, approved, UIApplication.shared.applicationState == .active else { return }
        switch manager.authorizationStatus {
        case .notDetermined: manager.requestWhenInUseAuthorization()
        case .authorizedWhenInUse, .authorizedAlways:
            manager.desiredAccuracy = requestedPrecision == "precise" ? kCLLocationAccuracyBest : kCLLocationAccuracyKilometer
            manager.requestLocation()
        case .denied, .restricted: finish(.failure(LocationFailure(code: "PERMISSION_DENIED")))
        @unknown default: finish(.failure(LocationFailure(code: "PERMISSION_DENIED")))
        }
    }
    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) { if approved { startLocation() } }
    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard pending != nil, approved else { return }
        guard UIApplication.shared.applicationState == .active else { finish(.failure(LocationFailure(code: "ENDPOINT_NOT_FOREGROUND"))); return }
        guard let location = locations.last, location.horizontalAccuracy >= 0,
              abs(location.timestamp.timeIntervalSinceNow) <= 30 else { finish(.failure(LocationFailure(code: "PROTOCOL_ERROR"))); return }
        let approximate = requestedPrecision == "approximate" || manager.accuracyAuthorization == .reducedAccuracy || location.horizontalAccuracy > 1000
        do { let data = try JSONSerialization.data(withJSONObject: ["latitude": approximate ? (location.coordinate.latitude * 50).rounded() / 50 : location.coordinate.latitude, "longitude": approximate ? (location.coordinate.longitude * 50).rounded() / 50 : location.coordinate.longitude,
            "accuracyMeters": approximate ? max(3000, location.horizontalAccuracy) : location.horizontalAccuracy, "capturedAt": Int64(location.timestamp.timeIntervalSince1970 * 1000),
            "precision": approximate ? "approximate" : "precise", "coordinateSystem": "WGS84"])
            finish(.success(data))
        } catch { finish(.failure(LocationFailure(code: "PROTOCOL_ERROR"))) }
    }
    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        finish(.failure(LocationFailure(code: (error as? CLError)?.code == .denied ? "PERMISSION_DENIED" : "PROTOCOL_ERROR")))
    }
    private func finish(_ result: Result<Data, Error>) {
        guard let continuation = pending else { return }
        pending = nil; pendingId = nil; approved = false; manager.stopUpdatingLocation(); timeout?.cancel(); timeout = nil
        consent?.dismiss(animated: false); consent = nil; continuation.resume(with: result)
    }
    struct LocationFailure: Error, Sendable { let code: String }
}
