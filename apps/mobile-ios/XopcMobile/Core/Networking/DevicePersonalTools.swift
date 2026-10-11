import Contacts
import ContactsUI
import EventKit
import Foundation
import PhotosUI
import UIKit
import UniformTypeIdentifiers

struct PersonalDeviceRequest: Decodable, Sendable {
    struct Arguments: Decodable, Sendable { let field: String?; let startAt: Int64?; let endAt: Int64? }
    struct UploadGrant: Decodable, Sendable { let path: String; let token: String; let maxBytes: Int; let expiresAt: Int64 }
    let invocationId: String
    let toolName: String
    let descriptorRevision: String
    let confirmationRequired: Bool
    let deadlineAt: Int64
    let arguments: Arguments
    let uploadGrant: UploadGrant?
}

struct PersonalDeviceSelection: Sendable {
    let name: String
    let mimeType: String
    let data: Data
}

struct PersonalDeviceFailure: Error { let code: String }

@MainActor
final class DevicePersonalTools: NSObject, UIDocumentPickerDelegate, PHPickerViewControllerDelegate, UIImagePickerControllerDelegate, UINavigationControllerDelegate, @preconcurrency CNContactPickerDelegate {
    static let shared = DevicePersonalTools()
    private var selection: CheckedContinuation<PersonalDeviceSelection, Error>?
    private var contactSelection: CheckedContinuation<Data, Error>?
    private var confirmation: CheckedContinuation<Bool, Never>?
    private var presented: UIViewController?
    private var field = "phone"
    private var busy = false
    private var activeInvocation: String?
    private var background: NSObjectProtocol?

    private var foregroundPresenter: UIViewController? {
        guard let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first(where: { $0.activationState == .foregroundActive }),
              var presenter = scene.windows.first(where: { $0.isKeyWindow })?.rootViewController else { return nil }
        while let next = presenter.presentedViewController {
            presenter = next
        }
        return presenter
    }

    func acquire(_ request: PersonalDeviceRequest) async throws -> Data {
        guard !busy else { throw PersonalDeviceFailure(code: "TOOL_BUSY") }
        guard foregroundPresenter != nil else { throw PersonalDeviceFailure(code: "ENDPOINT_NOT_FOREGROUND") }
        busy = true; activeInvocation = request.invocationId
        background = NotificationCenter.default.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { _ in
            MainActor.assumeIsolated { self.cancel() }
        }
        defer {
            if let background {
                NotificationCenter.default.removeObserver(background)
            }; background = nil; busy = false; activeInvocation = nil
        }
        return try await withTaskCancellationHandler {
            try Task.checkCancellation()
            let calendar = request.toolName.hasPrefix("mobile.calendar.")
            let startDate = Date(timeIntervalSince1970: Double(request.arguments.startAt ?? 0) / 1000)
            let endDate = Date(timeIntervalSince1970: Double(request.arguments.endAt ?? 0) / 1000)
            let calendarDetail = request.toolName.hasSuffix("free_busy") ? "忙闲时间（不含标题）" : "时间和标题"
            let scope = calendar
                ? "读取本机可访问日历中 \(startDate) 至 \(endDate) 的\(calendarDetail)，最多 50 条。"
                : "请在接下来的系统页面选择本次要提供给 Agent 的文件、照片或联系人字段。"
            guard await confirm(scope + "所选内容会发送给 Agent，并可能保存在聊天历史中。") else { throw PersonalDeviceFailure(code: "USER_DENIED") }
            try await Task.sleep(for: .milliseconds(350))
            try Task.checkCancellation()
            if calendar {
                return try await calendarContent(request)
            }
            if request.toolName == "mobile.contacts.pick" {
                field = request.arguments.field ?? "phone"
                return try await withCheckedThrowingContinuation { continuation in
                    contactSelection = continuation
                    let picker = CNContactPickerViewController(); picker.delegate = self
                    picker.displayedPropertyKeys = [field == "phone" ? CNContactPhoneNumbersKey : CNContactEmailAddressesKey]
                    picker.predicateForEnablingContact = NSPredicate(format: "\(field == "phone" ? "phoneNumbers" : "emailAddresses").@count > 0")
                    picker.predicateForSelectionOfContact = NSPredicate(value: false)
                    picker.predicateForSelectionOfProperty = NSPredicate(format: "key == %@", field == "phone" ? CNContactPhoneNumbersKey : CNContactEmailAddressesKey)
                    present(picker)
                }
            }
            let selected = try await selectFile(request.toolName)
            return try JSONEncoder().encode(SelectionWire(name: selected.name, mimeType: selected.mimeType, data: selected.data))
        } onCancel: { Task {
            @MainActor in if self.activeInvocation == request.invocationId {
                self.cancel()
            }
        } }
    }

    struct SelectionWire: Codable, Sendable { let name: String; let mimeType: String; let data: Data }
    private func present(_ controller: UIViewController) {
        guard let presenter = foregroundPresenter else { cancel(); return }
        presented = controller; presenter.present(controller, animated: true)
    }

    private func confirm(_ message: String) async -> Bool {
        await withCheckedContinuation { continuation in
            confirmation = continuation
            let alert = UIAlertController(title: "允许本次提供设备信息？", message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "拒绝", style: .cancel) { _ in self.confirmation?.resume(returning: false); self.confirmation = nil; self.presented = nil })
            alert.addAction(UIAlertAction(title: "继续", style: .default) { _ in self.confirmation?.resume(returning: true); self.confirmation = nil; self.presented = nil })
            present(alert)
        }
    }

    private func cancel() {
        confirmation?.resume(returning: false); confirmation = nil
        selection?.resume(throwing: CancellationError()); selection = nil
        contactSelection?.resume(throwing: CancellationError()); contactSelection = nil
        presented?.dismiss(animated: false); presented = nil
    }

    private func finish(_ result: Result<PersonalDeviceSelection, Error>) {
        selection?.resume(with: result); selection = nil
        presented?.dismiss(animated: true); presented = nil
    }

    private func selectFile(_ name: String) async throws -> PersonalDeviceSelection {
        try await withCheckedThrowingContinuation { continuation in
            selection = continuation
            if name == "mobile.media.pick" {
                var configuration = PHPickerConfiguration(); configuration.filter = .images; configuration.selectionLimit = 1
                let picker = PHPickerViewController(configuration: configuration); picker.delegate = self; present(picker)
            } else if name == "mobile.camera.capture" {
                guard UIImagePickerController.isSourceTypeAvailable(.camera) else { finish(.failure(PersonalDeviceFailure(code: "PERMISSION_DENIED"))); return }
                let picker = UIImagePickerController(); picker.sourceType = .camera; picker.delegate = self; present(picker)
            } else {
                let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.item], asCopy: true); picker.delegate = self; picker.allowsMultipleSelection = false; present(picker)
            }
        }
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        guard controller === presented else { return }; finish(.failure(PersonalDeviceFailure(code: "USER_DENIED")))
    }

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard controller === presented, selection != nil, let url = urls.first else { return }
        let access = url.startAccessingSecurityScopedResource(); defer {
            if access {
                url.stopAccessingSecurityScopedResource()
            }
        }
        do {
            let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
            guard size <= 10 * 1024 * 1024 else { throw PersonalDeviceFailure(code: "RESULT_TOO_LARGE") }
            let data = try Data(contentsOf: url)
            guard data.count <= 10 * 1024 * 1024 else { throw PersonalDeviceFailure(code: "RESULT_TOO_LARGE") }
            finish(.success(PersonalDeviceSelection(name: String(url.lastPathComponent.prefix(255)), mimeType: UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream", data: data)))
        } catch { finish(.failure(error)) }
    }

    func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        guard picker === presented else { return }
        guard let item = results.first, selection != nil else { finish(.failure(PersonalDeviceFailure(code: "USER_DENIED"))); return }
        // The provider supplies only the user-selected image; re-encoding excludes photo metadata.
        item.itemProvider.loadObject(ofClass: UIImage.self) { image, _ in
            let data = (image as? UIImage)?.jpegData(compressionQuality: 0.85)
            Task { @MainActor in
                guard self.presented === picker, self.selection != nil else { return }
                guard let data, data.count <= 10 * 1024 * 1024 else { self.finish(.failure(PersonalDeviceFailure(code: "RESULT_TOO_LARGE"))); return }
                self.finish(.success(PersonalDeviceSelection(name: "selected-photo.jpg", mimeType: "image/jpeg", data: data)))
            }
        }
    }

    func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
        guard picker === presented else { return }; finish(.failure(PersonalDeviceFailure(code: "USER_DENIED")))
    }

    func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
        guard picker === presented, selection != nil else { return }
        guard let image = info[.originalImage] as? UIImage,
              let data = image.jpegData(compressionQuality: 0.85), data.count <= 10 * 1024 * 1024
        else { finish(.failure(PersonalDeviceFailure(code: "RESULT_TOO_LARGE"))); return }
        finish(.success(PersonalDeviceSelection(name: "camera-photo.jpg", mimeType: "image/jpeg", data: data)))
    }

    func contactPickerDidCancel(_ picker: CNContactPickerViewController) {
        guard picker === presented else { return }; contactSelection?.resume(throwing: PersonalDeviceFailure(code: "USER_DENIED")); contactSelection = nil; presented = nil
    }

    func contactPicker(_ picker: CNContactPickerViewController, didSelect contactProperty: CNContactProperty) {
        guard picker === presented, let continuation = contactSelection else { return }
        let contact = contactProperty.contact
        let name = String((CNContactFormatter.string(from: contact, style: .fullName) ?? "Selected contact").prefix(500))
        let phone = (contactProperty.value as? CNPhoneNumber)?.stringValue
        let email = contactProperty.value as? String
        let value: [String: Any] = ["id": UUID().uuidString, "name": name.isEmpty ? "Selected contact" : name,
                                    "phones": field == "phone" ? phone.map { [String($0.prefix(100))] } ?? [] : [],
                                    "emails": field == "email" ? email.map { [String($0.prefix(320))] } ?? [] : []]
        do { try continuation.resume(returning: JSONSerialization.data(withJSONObject: ["type": "json", "value": value])) }
        catch { continuation.resume(throwing: error) }
        contactSelection = nil; presented = nil
    }

    private func calendarContent(_ request: PersonalDeviceRequest) async throws -> Data {
        let store = EKEventStore()
        guard try await store.requestFullAccessToEvents() else { throw PersonalDeviceFailure(code: "PERMISSION_DENIED") }
        try Task.checkCancellation()
        guard foregroundPresenter != nil, let start = request.arguments.startAt, let end = request.arguments.endAt else { throw PersonalDeviceFailure(code: "ENDPOINT_NOT_FOREGROUND") }
        let predicate = store.predicateForEvents(
            withStart: Date(timeIntervalSince1970: Double(start) / 1000),
            end: Date(timeIntervalSince1970: Double(end) / 1000), calendars: nil
        )
        let events = store.events(matching: predicate).filter { $0.status != .canceled }.sorted { $0.startDate < $1.startDate }
        let entries: [[String: Any]] = events.prefix(50).map { event in
            var value: [String: Any] = [
                "startAt": Int64(event.startDate.timeIntervalSince1970 * 1000),
                "endAt": Int64(event.endDate.timeIntervalSince1970 * 1000),
                "allDay": event.isAllDay, "busy": event.availability != .free
            ]
            if !request.toolName.hasSuffix("free_busy") {
                value["title"] = String((event.title ?? "").prefix(500))
            }
            return value
        }
        let value: [String: Any] = ["capturedAt": Int64(Date().timeIntervalSince1970 * 1000), "startAt": start, "endAt": end,
                                    "timeZone": TimeZone.current.identifier, "accessScope": "all_accessible", "truncated": events.count > 50, "events": entries]
        return try JSONSerialization.data(withJSONObject: ["type": "json", "value": value])
    }
}
