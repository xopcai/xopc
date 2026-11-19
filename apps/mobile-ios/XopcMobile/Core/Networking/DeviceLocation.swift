import CoreLocation
import UIKit

@MainActor
final class DeviceLocation: NSObject, @preconcurrency CLLocationManagerDelegate {
    static let shared = DeviceLocation()
    private let manager = CLLocationManager()
    private var pending: CheckedContinuation<Data, Error>?
    private var timeout: Task<Void, Never>?
    private var requestedPrecision = "approximate"
    private var pendingId: UUID?

    override private init() {
        super.init(); manager.delegate = self
        NotificationCenter.default.addObserver(self, selector: #selector(backgrounded), name: UIApplication.didEnterBackgroundNotification, object: nil)
    }

    @objc private func backgrounded() {
        finish(.failure(LocationFailure(code: "ENDPOINT_NOT_FOREGROUND")))
    }

    func acquire(precision: String, deadline: Double) async throws -> Data {
        guard pending == nil else { throw LocationFailure(code: "TOOL_BUSY") }
        guard UIApplication.shared.applicationState == .active else { throw LocationFailure(code: "ENDPOINT_NOT_FOREGROUND") }
        let requestId = UUID()
        requestedPrecision = precision
        return try await withTaskCancellationHandler(operation: {
            try Task.checkCancellation()
            return try await withCheckedThrowingContinuation { continuation in
                pending = continuation; pendingId = requestId
                let remaining = max(0, min(90000, deadline - Date().timeIntervalSince1970 * 1000))
                timeout = Task { [weak self] in
                    do { try await Task.sleep(for: .milliseconds(remaining)); self?.finish(.failure(LocationFailure(code: "TOOL_TIMEOUT"))) }
                    catch {}
                }
                startLocation()
            }
        }, onCancel: { Task { @MainActor in DeviceLocation.shared.cancel(requestId) } })
    }

    private func cancel(_ id: UUID) {
        if pendingId == id {
            finish(.failure(LocationFailure(code: "TOOL_CANCELLED")))
        }
    }

    private func startLocation() {
        guard pending != nil, UIApplication.shared.applicationState == .active else { return }
        switch manager.authorizationStatus {
        case .notDetermined: manager.requestWhenInUseAuthorization()
        case .authorizedWhenInUse, .authorizedAlways:
            manager.desiredAccuracy = requestedPrecision == "precise" ? kCLLocationAccuracyBest : kCLLocationAccuracyKilometer
            manager.requestLocation()
        case .denied, .restricted: finish(.failure(LocationFailure(code: "PERMISSION_DENIED")))
        @unknown default: finish(.failure(LocationFailure(code: "PERMISSION_DENIED")))
        }
    }

    func locationManagerDidChangeAuthorization(_: CLLocationManager) {
        startLocation()
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard pending != nil else { return }
        guard UIApplication.shared.applicationState == .active else { finish(.failure(LocationFailure(code: "ENDPOINT_NOT_FOREGROUND"))); return }
        guard let location = locations.last, location.horizontalAccuracy >= 0,
              abs(location.timestamp.timeIntervalSinceNow) <= 30 else { finish(.failure(LocationFailure(code: "PROTOCOL_ERROR"))); return }
        let approximate = requestedPrecision == "approximate" || manager.accuracyAuthorization == .reducedAccuracy || location.horizontalAccuracy > 1000
        let latitude = approximate ? (location.coordinate.latitude * 50).rounded() / 50 : location.coordinate.latitude
        let longitude = approximate ? (location.coordinate.longitude * 50).rounded() / 50 : location.coordinate.longitude
        let accuracy = approximate ? max(3000, location.horizontalAccuracy) : location.horizontalAccuracy
        let reading: [String: Any] = ["latitude": latitude, "longitude": longitude,
                                      "accuracyMeters": accuracy, "capturedAt": Int64(location.timestamp.timeIntervalSince1970 * 1000),
                                      "precision": approximate ? "approximate" : "precise", "coordinateSystem": "WGS84"]
        do {
            let data = try JSONSerialization.data(withJSONObject: reading)
            finish(.success(data))
        } catch {
            finish(.failure(LocationFailure(code: "PROTOCOL_ERROR")))
        }
    }

    func locationManager(_: CLLocationManager, didFailWithError error: Error) {
        finish(.failure(LocationFailure(code: (error as? CLError)?.code == .denied ? "PERMISSION_DENIED" : "PROTOCOL_ERROR")))
    }

    private func finish(_ result: Result<Data, Error>) {
        guard let continuation = pending else { return }
        pending = nil; pendingId = nil; manager.stopUpdatingLocation(); timeout?.cancel(); timeout = nil
        continuation.resume(with: result)
    }

    struct LocationFailure: Error, Sendable { let code: String }
}
