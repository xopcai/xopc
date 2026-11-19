import Contacts
import ContactsUI
import EventKit
import Foundation
import Photos
import PhotosUI
import UIKit
import UniformTypeIdentifiers

struct PersonalDeviceRequest: Decodable, Sendable {
    struct Arguments: Decodable, Sendable { let field: String?; let startAt: Int64?; let endAt: Int64?; let query: String?; let title: String?; let id: String?; let album: String? }
    struct UploadGrant: Decodable, Sendable { let path: String; let token: String; let maxBytes: Int; let expiresAt: Int64 }
    let invocationId: String
    let toolName: String
    let descriptorRevision: String
    let confirmationRequired: Bool
    let gatewayCapabilityAuthorized: Bool?
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

    func prepareCapabilityPermission(_ name: String) async throws {
        guard !busy else { throw PersonalDeviceFailure(code: "TOOL_BUSY") }
        busy = true
        defer { busy = false }
        switch name {
        case "mobile.calendar.query_events", "mobile.calendar.query_free_busy":
            guard try await EKEventStore().requestFullAccessToEvents() else { throw PersonalDeviceFailure(code: "PERMISSION_DENIED") }
        case "mobile.calendar.create_event":
            if EKEventStore.authorizationStatus(for: .event) != .fullAccess {
                guard try await EKEventStore().requestWriteOnlyAccessToEvents() else { throw PersonalDeviceFailure(code: "PERMISSION_DENIED") }
            }
        case "mobile.contacts.find_by_name":
            guard try await CNContactStore().requestAccess(for: .contacts) else { throw PersonalDeviceFailure(code: "PERMISSION_DENIED") }
        case "mobile.media.list_recent", "mobile.media.read_image", "mobile.media.add_to_album":
            try await allowPhotoAccess()
        case "mobile.device.get_location":
            try await DeviceLocation.shared.preparePermission()
        default:
            break
        }
        try Task.checkCancellation()
    }

    func acquire(_ request: PersonalDeviceRequest, capabilityScope: String?) async throws -> Data {
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
            if request.gatewayCapabilityAuthorized != true, let capability = Self.writeCapabilityTitle(request.toolName) {
                guard let capabilityScope else { throw PersonalDeviceFailure(code: "PERMISSION_DENIED") }
                let key = "device-capability.\(capabilityScope).\(request.toolName)"
                if !UserDefaults.standard.bool(forKey: key) {
                    guard await confirm("允许后，当前 Gateway 可以继续使用「" + capability + "」。", title: "允许 Gateway 使用「" + capability + "」？") else {
                        throw PersonalDeviceFailure(code: "USER_DENIED")
                    }
                    try Task.checkCancellation()
                    UserDefaults.standard.set(true, forKey: key)
                }
            }
            return try await acquireContent(request)
        } onCancel: { Task {
            @MainActor in if self.activeInvocation == request.invocationId {
                self.cancel()
            }
        } }
    }

    private static func writeCapabilityTitle(_ toolName: String) -> String? {
        switch toolName {
        case "mobile.calendar.create_event": "创建日程"
        case "mobile.media.add_to_album": "整理相册"
        default: nil
        }
    }

    private func acquireContent(_ request: PersonalDeviceRequest) async throws -> Data {
        switch request.toolName {
        case "mobile.contacts.find_by_name":
            return try await findContacts(request.arguments.query)
        case "mobile.calendar.create_event":
            return try await createEvent(request.arguments)
        case "mobile.media.list_recent":
            return try await listPhotos()
        case "mobile.media.read_image":
            try await allowPhotoAccess()
            let asset = try photo(request.arguments.id)
            let image = try await loadPhoto(asset)
            return try JSONEncoder().encode(SelectionWire(name: "photo.jpg", mimeType: "image/jpeg", data: image))
        case "mobile.media.add_to_album":
            return try await addPhotoToAlbum(request.arguments)
        case "mobile.contacts.pick":
            return try await pickContact(field: request.arguments.field ?? "phone")
        default:
            if request.toolName.hasPrefix("mobile.calendar.") {
                return try await calendarContent(request)
            }
            return try await acquireSelectedFile(request.toolName)
        }
    }

    private func acquireSelectedFile(_ toolName: String) async throws -> Data {
        let selected = try await selectFile(toolName)
        return try JSONEncoder().encode(SelectionWire(name: selected.name, mimeType: selected.mimeType, data: selected.data))
    }

    private func pickContact(field selectedField: String) async throws -> Data {
        field = selectedField
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

    struct SelectionWire: Codable, Sendable { let name: String; let mimeType: String; let data: Data }
    private func present(_ controller: UIViewController) {
        guard let presenter = foregroundPresenter else { cancel(); return }
        presented = controller; presenter.present(controller, animated: true)
    }

    private func confirm(_ message: String, title: String) async -> Bool {
        await withCheckedContinuation { continuation in
            confirmation = continuation
            let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "拒绝", style: .cancel) { _ in self.confirmation?.resume(returning: false); self.confirmation = nil; self.presented = nil })
            alert.addAction(UIAlertAction(title: "允许", style: .default) { _ in self.confirmation?.resume(returning: true); self.confirmation = nil; self.presented = nil })
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
}

extension DevicePersonalTools {
    private func allowPhotoAccess() async throws {
        var status = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        if status == .notDetermined {
            status = await PHPhotoLibrary.requestAuthorization(for: .readWrite)
        }
        guard status == .authorized || status == .limited else { throw PersonalDeviceFailure(code: "PERMISSION_DENIED") }
        try Task.checkCancellation()
        guard foregroundPresenter != nil else { throw PersonalDeviceFailure(code: "ENDPOINT_NOT_FOREGROUND") }
    }

    private func listPhotos() async throws -> Data {
        try await allowPhotoAccess()
        let options = PHFetchOptions()
        options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
        options.fetchLimit = 20
        let assets = PHAsset.fetchAssets(with: .image, options: options)
        let result: [[String: Any]] = (0 ..< assets.count).map { index in
            let asset = assets.object(at: index)
            return ["id": asset.localIdentifier, "capturedAt": Int64(max(0, (asset.creationDate?.timeIntervalSince1970 ?? 0) * 1000))]
        }
        return try JSONSerialization.data(withJSONObject: ["type": "json", "value": result])
    }

    private func photo(_ id: String?) throws -> PHAsset {
        guard let id, !id.isEmpty, id.utf16.count <= 512 else { throw PersonalDeviceFailure(code: "INVALID_ARGUMENTS") }
        guard let asset = PHAsset.fetchAssets(withLocalIdentifiers: [id], options: nil).firstObject, asset.mediaType == .image else {
            throw PersonalDeviceFailure(code: "PERMISSION_DENIED")
        }
        return asset
    }

    private func loadPhoto(_ asset: PHAsset) async throws -> Data {
        let options = PHImageRequestOptions()
        options.deliveryMode = .highQualityFormat
        options.resizeMode = .exact
        options.isNetworkAccessAllowed = false
        return try await withCheckedThrowingContinuation { continuation in
            PHImageManager.default().requestImage(for: asset, targetSize: CGSize(width: 2048, height: 2048), contentMode: .aspectFit, options: options) { image, info in
                if (info?[PHImageResultIsDegradedKey] as? Bool) == true {
                    return
                }
                guard let data = image?.jpegData(compressionQuality: 0.85), data.count <= 10 * 1024 * 1024 else {
                    continuation.resume(throwing: PersonalDeviceFailure(code: "RESULT_TOO_LARGE"))
                    return
                }
                continuation.resume(returning: data)
            }
        }
    }

    private func addPhotoToAlbum(_ arguments: PersonalDeviceRequest.Arguments) async throws -> Data {
        guard let album = arguments.album?.trimmingCharacters(in: .whitespacesAndNewlines),
              !album.isEmpty, album.utf16.count <= 100 else { throw PersonalDeviceFailure(code: "INVALID_ARGUMENTS") }
        try await allowPhotoAccess()
        let asset = try photo(arguments.id)
        try Task.checkCancellation()
        guard foregroundPresenter != nil else { throw PersonalDeviceFailure(code: "ENDPOINT_NOT_FOREGROUND") }
        let options = PHFetchOptions()
        options.predicate = NSPredicate(format: "title == %@", album)
        let albums = PHAssetCollection.fetchAssetCollections(with: .album, subtype: .albumRegular, options: options)
        guard albums.count <= 1 else { throw PersonalDeviceFailure(code: "INVALID_ARGUMENTS") }
        let existing = albums.firstObject
        if let existing, !existing.canPerform(.addContent) {
            throw PersonalDeviceFailure(code: "PERMISSION_DENIED")
        }
        try await PHPhotoLibrary.shared().performChanges {
            if let existing, let change = PHAssetCollectionChangeRequest(for: existing) {
                change.addAssets([asset] as NSArray)
            } else if existing == nil {
                let change = PHAssetCollectionChangeRequest.creationRequestForAssetCollection(withTitle: album)
                change.addAssets([asset] as NSArray)
            }
        }
        return try JSONSerialization.data(withJSONObject: ["type": "json", "value": ["id": asset.localIdentifier]])
    }

    private func findContacts(_ input: String?) async throws -> Data {
        guard let query = input?.trimmingCharacters(in: .whitespacesAndNewlines), !query.isEmpty, query.utf16.count <= 100 else {
            throw PersonalDeviceFailure(code: "INVALID_ARGUMENTS")
        }
        let store = CNContactStore()
        guard try await store.requestAccess(for: .contacts) else { throw PersonalDeviceFailure(code: "PERMISSION_DENIED") }
        try Task.checkCancellation()
        guard foregroundPresenter != nil else { throw PersonalDeviceFailure(code: "ENDPOINT_NOT_FOREGROUND") }
        let keys = [CNContactFormatter.descriptorForRequiredKeys(for: .fullName), CNContactPhoneNumbersKey as CNKeyDescriptor,
                    CNContactEmailAddressesKey as CNKeyDescriptor, CNContactIdentifierKey as CNKeyDescriptor]
        let predicate = CNContact.predicateForContacts(matchingName: query)
        let contacts = try store.unifiedContacts(matching: predicate, keysToFetch: keys)
        let matches: [[String: Any]] = contacts.prefix(20).compactMap { contact in
            guard let name = CNContactFormatter.string(from: contact, style: .fullName), !name.isEmpty else { return nil }
            return ["id": String(contact.identifier.prefix(512)), "name": String(name.prefix(500)),
                    "phones": contact.phoneNumbers.prefix(20).map { String($0.value.stringValue.prefix(100)) },
                    "emails": contact.emailAddresses.prefix(20).map { String(($0.value as String).prefix(320)) }]
        }
        return try JSONSerialization.data(withJSONObject: ["type": "json", "value": matches])
    }

    private func createEvent(_ arguments: PersonalDeviceRequest.Arguments) async throws -> Data {
        guard let title = arguments.title?.trimmingCharacters(in: .whitespacesAndNewlines), !title.isEmpty, title.utf16.count <= 500,
              let startAt = arguments.startAt, let endAt = arguments.endAt
        else {
            throw PersonalDeviceFailure(code: "INVALID_ARGUMENTS")
        }
        let start = Date(timeIntervalSince1970: Double(startAt) / 1000)
        let end = Date(timeIntervalSince1970: Double(endAt) / 1000)
        try Task.checkCancellation()
        let store = EKEventStore()
        if EKEventStore.authorizationStatus(for: .event) != .fullAccess {
            guard try await store.requestWriteOnlyAccessToEvents() else { throw PersonalDeviceFailure(code: "PERMISSION_DENIED") }
        }
        try Task.checkCancellation()
        guard foregroundPresenter != nil else { throw PersonalDeviceFailure(code: "ENDPOINT_NOT_FOREGROUND") }
        guard let calendar = store.defaultCalendarForNewEvents else { throw PersonalDeviceFailure(code: "PERMISSION_DENIED") }
        let event = EKEvent(eventStore: store)
        event.calendar = calendar
        event.title = title
        event.startDate = start
        event.endDate = end
        try store.save(event, span: .thisEvent)
        return try JSONSerialization.data(withJSONObject: ["type": "json", "value": ["id": event.eventIdentifier ?? event.calendarItemIdentifier]])
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
