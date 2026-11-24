import Foundation
import Network

enum ChatConnectionPhase: Equatable, Sendable {
    case reconnecting, phoneOffline, connected
}

struct DeviceEndpointConnectionState {
    fileprivate var connection: Task<DeviceEndpointOrigin, Error>?
    fileprivate var connectionGeneration = 0
    fileprivate var recovery: Task<Void, Never>?
    fileprivate var recoveryGeneration = 0
    fileprivate var connectionPhase: ChatConnectionPhase = .reconnecting
    fileprivate var connectionObservers: [UUID: AsyncStream<ChatConnectionPhase>.Continuation] = [:]
    fileprivate var networkMonitor: NWPathMonitor?
    fileprivate var networkMonitorID: UUID?
    fileprivate var networkPathObservation: Task<Void, Never>?
    fileprivate var networkPath: NWPath?
    fileprivate var networkLoss: Task<Void, Never>?
}

extension DeviceEndpointHost {
    func origin() async throws -> DeviceEndpointOrigin {
        guard !retired else { throw CancellationError() }
        guard connectionState.networkPath?.status != .unsatisfied else { throw GatewayClientError.transport }
        if let claim {
            return claim
        }
        if connectionState.connection == nil {
            connectionState.connectionGeneration += 1
            connectionState.connection = Task { try await connect() }
        }
        guard let connection = connectionState.connection else { throw GatewayClientError.transport }
        let generation = connectionState.connectionGeneration
        defer {
            if generation == connectionState.connectionGeneration {
                self.connectionState.connection = nil
            }
        }
        do { return try await connection.value }
        catch is CancellationError where !retired && generation != connectionState.connectionGeneration {
            throw GatewayClientError.transport
        }
    }

    func connectionChanges() -> AsyncStream<ChatConnectionPhase> {
        let (stream, continuation) = AsyncStream<ChatConnectionPhase>.makeStream(bufferingPolicy: .bufferingNewest(1))
        guard !retired else { continuation.finish(); return stream }
        let id = UUID()
        connectionState.connectionObservers[id] = continuation
        continuation.onTermination = { [weak self] _ in Task { await self?.removeConnectionObserver(id) } }
        if connectionState.connectionPhase == .phoneOffline, connectionState.networkPath == nil {
            setConnectionPhase(.reconnecting)
        }
        continuation.yield(connectionState.connectionPhase)
        startNetworkMonitor()
        scheduleConnectionRecovery()
        return stream
    }

    func retryConnection() {
        guard !retired, claim == nil, connectionState.networkPath?.status != .unsatisfied else { return }
        restartConnection()
    }

    func setConnectionPhase(_ phase: ChatConnectionPhase) {
        guard connectionState.connectionPhase != phase else { return }
        connectionState.connectionPhase = phase
        for observer in connectionState.connectionObservers.values {
            observer.yield(phase)
        }
    }

    private func scheduleConnectionRecovery() {
        guard !retired, !connectionState.connectionObservers.isEmpty, connectionState.recovery == nil,
              claim == nil, connectionState.networkPath?.status != .unsatisfied else { return }
        connectionState.recoveryGeneration += 1
        let generation = connectionState.recoveryGeneration
        connectionState.recovery = Task { [weak self] in await self?.recoverConnection(generation: generation) }
    }

    private func recoverConnection(generation: Int) async {
        defer {
            if generation == connectionState.recoveryGeneration {
                connectionState.recovery = nil
            }
        }
        var delay = 1
        while !Task.isCancelled, claim == nil {
            do {
                _ = try await origin()
                guard !Task.isCancelled else { return }
                if claim != nil {
                    return
                }
            } catch {
                if Task.isCancelled {
                    return
                }
            }
            do { try await Task.sleep(for: .seconds(delay)) } catch { return }
            delay = min(delay * 2, 30)
        }
    }

    private func stopRecovery() {
        connectionState.recoveryGeneration += 1
        connectionState.recovery?.cancel()
        connectionState.recovery = nil
    }

    private func cancelConnection() {
        connectionState.connectionGeneration += 1
        connectionState.connection?.cancel()
        connectionState.connection = nil
    }

    private func restartConnection() {
        stopRecovery()
        cancelConnection()
        closeSocket()
    }

    private func startNetworkMonitor() {
        guard connectionState.networkMonitor == nil else { return }
        let monitor = NWPathMonitor()
        let id = UUID()
        connectionState.networkMonitor = monitor
        connectionState.networkMonitorID = id
        // Deliver path callbacks in order even when the main actor is busy with history.
        let (paths, changes) = AsyncStream<NWPath>.makeStream(bufferingPolicy: .bufferingNewest(1))
        monitor.pathUpdateHandler = { path in changes.yield(path) }
        changes.onTermination = { _ in monitor.cancel() }
        connectionState.networkPathObservation = Task { [weak self] in
            for await path in paths {
                await self?.networkPathChanged(path, monitorID: id)
            }
        }
        monitor.start(queue: DispatchQueue(label: "ai.xopc.chat-network"))
    }

    private func networkPathChanged(_ path: NWPath, monitorID: UUID) {
        guard connectionState.networkMonitorID == monitorID else { return }
        connectionState.networkLoss?.cancel()
        connectionState.networkLoss = nil
        if path.status == .unsatisfied {
            connectionState.networkLoss = Task { [weak self] in
                do { try await Task.sleep(for: .milliseconds(400)) } catch { return }
                await self?.applyNetworkLoss(path, monitorID: monitorID)
            }
            return
        }
        let previous = connectionState.networkPath
        connectionState.networkPath = path
        guard let previous, previous != path else { return }
        if let socket, claim != nil {
            Task { await probeRoute(socket) }
        } else {
            restartConnection()
        }
    }

    private func applyNetworkLoss(_ path: NWPath, monitorID: UUID) {
        guard !Task.isCancelled, connectionState.networkMonitorID == monitorID else { return }
        connectionState.networkPath = path
        connectionState.networkLoss = nil
        restartConnection()
    }

    private func removeConnectionObserver(_ id: UUID) {
        connectionState.connectionObservers.removeValue(forKey: id)
        if connectionState.connectionObservers.isEmpty {
            stopNetworkMonitor(); stopRecovery()
        }
    }

    private func stopNetworkMonitor() {
        connectionState.networkMonitorID = nil
        connectionState.networkPathObservation?.cancel(); connectionState.networkPathObservation = nil
        connectionState.networkMonitor?.cancel()
        connectionState.networkMonitor = nil
        connectionState.networkLoss?.cancel()
        connectionState.networkLoss = nil
        connectionState.networkPath = nil
    }

    func probeRoute(_ socket: URLSessionWebSocketTask) async {
        guard self.socket === socket else { return }
        let sentAt = Date()
        lastPingSentAt = sentAt
        probeTask?.cancel()
        probeTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(2500))
            guard !Task.isCancelled else { return }
            await self?.verifyProbeResponse(socket: socket, sentAt: sentAt)
        }
        do { try await send("realtime.ping", ["availability": "foreground"]) }
        catch {
            if self.socket === socket {
                closeSocket()
            }
        }
    }

    private func verifyProbeResponse(socket: URLSessionWebSocketTask, sentAt: Date) {
        guard self.socket === socket, lastReceivedAt < sentAt else { return }
        closeSocket()
    }

    func stopConnectionTracking() {
        for observer in connectionState.connectionObservers.values {
            observer.finish()
        }
        connectionState.connectionObservers.removeAll()
        stopRecovery()
        stopNetworkMonitor()
        cancelConnection()
    }

    func continueConnectionRecovery() {
        setConnectionPhase(connectionState.networkPath?.status == .unsatisfied ? .phoneOffline : .reconnecting)
        scheduleConnectionRecovery()
    }
}
