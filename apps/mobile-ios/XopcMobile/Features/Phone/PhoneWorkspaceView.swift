import SwiftUI
import UIKit

struct PhoneWorkspaceView: View {
    let model: PhoneWorkspaceModel
    let onReturn: () -> Void
    @State private var textOpen = false
    @State private var draft = ""
    @State private var stopOpen = false
    @State private var stopSession = ""
    private var ownControl: Bool { model.live?.ownControl == true }
    private var status: LocalizedStringKey {
        if model.busy { return "正在交接控制权…" }
        if ownControl { return "你正在操作 · AI 已暂停" }
        if model.live?.report.controlOwner == "human" { return "其他客户端正在操作" }
        switch model.live?.report.status {
        case "needs_user": return "需要你处理"
        case "paused": return "任务已暂停"
        case "running": return "AI 操作中"
        case "completed": return "任务已完成"
        default: return "已连接"
        }
    }
    var body: some View {
        VStack(spacing: 12) {
            HStack(spacing: 12) {
                Button(action: onReturn) { Image(systemName: "chevron.left").font(.title3).frame(width: 44, height: 44) }
                    .accessibilityLabel("返回对话").accessibilityIdentifier("phone-return")
                VStack(alignment: .leading, spacing: 3) {
                    Text(verbatim: model.summary?.deviceName ?? "").font(.headline).lineLimit(1)
                    Text(status).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer(minLength: 0)
                Menu {
                    if ownControl {
                        Button("返回键", systemImage: "arrow.uturn.backward") { command("input", action: PhoneAction(type: "back")) }
                        Button("输入文字", systemImage: "keyboard") { draft = ""; textOpen = true }
                            .disabled(model.live?.textInput == "manual")
                        Button("结束控制，保持暂停", systemImage: "hand.raised") { command("release") }
                    } else if model.canControl && model.live?.report.reconnectRequired != true {
                        Button(model.live?.report.status == "paused" ? "继续任务" : "暂停任务", systemImage: model.live?.report.status == "paused" ? "play" : "pause") {
                            command(model.live?.report.status == "paused" ? "handback" : "pause")
                        }
                    }
                    Button("重新连接", systemImage: "arrow.clockwise") { Task { await model.retry() } }
                        .disabled(model.summary?.access == "none")
                    if model.canControl {
                        Divider()
                        Button("停止任务", systemImage: "stop.circle", role: .destructive) { stopSession = model.live?.report.sessionId ?? ""; stopOpen = true }
                    }
                } label: {
                    Image(systemName: "ellipsis.circle").font(.title2).frame(width: 44, height: 44)
                        .background(Color(uiColor: .secondarySystemGroupedBackground), in: Circle())
                }.accessibilityLabel("更多手机操作").accessibilityIdentifier("phone-more").disabled(model.busy)
            }.buttonStyle(.plain)
            GeometryReader { proxy in
                ZStack {
                    PhoneVideoSurface(video: model.video).opacity(model.playing ? 1 : 0)
                        .accessibilityIdentifier(model.playing ? "phone-video-live" : "phone-video-connecting")
                    if model.fallback, let frame = model.frame {
                        Image(uiImage: frame.image).resizable().scaledToFit()
                    }
                    if !model.playing && !(model.fallback && model.frame != nil) {
                        VStack(spacing: 16) {
                            if model.summary?.available != false && model.summary?.access != "none" && !model.failed && model.live?.report.reconnectRequired != true {
                                RoundedRectangle(cornerRadius: 8).fill(.quaternary).frame(width: proxy.size.width * 0.6, height: 28)
                                RoundedRectangle(cornerRadius: 16).fill(.quaternary).frame(width: proxy.size.width * 0.8, height: 180)
                            }
                            Text(placeholder).foregroundStyle(.secondary).multilineTextAlignment(.center)
                        }.padding(24).frame(maxWidth: .infinity, maxHeight: .infinity)
                            .background(Color(uiColor: .secondarySystemGroupedBackground))
                    }
                    if ownControl && !model.busy {
                        PhoneTouchSurface { phase, point in
                            let ratio = model.fallback ? (model.frame?.image.size.width ?? 1) / (model.frame?.image.size.height ?? 2) : CGFloat(model.width) / CGFloat(model.height)
                            let width = min(proxy.size.width, proxy.size.height * ratio)
                            let height = width / ratio
                            let x = (point.x - (proxy.size.width - width) / 2) / width * 1000
                            let y = (point.y - (proxy.size.height - height) / 2) / height * 1000
                            guard x >= 0, x <= 1000, y >= 0, y <= 1000 else { model.pointer("cancel", x: 0, y: 0); return }
                            model.pointer(phase, x: Int(x), y: Int(y))
                        }
                    }
                }.frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Color(uiColor: .secondarySystemGroupedBackground)).clipShape(.rect(cornerRadius: 16))
            }
            if model.fallback { Text("截图模式").font(.caption).foregroundStyle(.secondary) }
            if model.failed, model.live != nil { Text("操作尚未确认，请检查手机状态后再试。").font(.footnote).foregroundStyle(.red) }
            if model.canControl {
                Button { command(ownControl ? "handback" : "takeover") } label: {
                    Text(ownControl ? "交回 AI" : "接管手机").font(.headline).frame(maxWidth: .infinity).frame(height: 52)
                        .foregroundStyle(ownControl ? Color.primary : Color.white)
                        .background(ownControl ? Color(uiColor: .tertiarySystemFill) : Color.accentColor, in: Capsule())
                }.buttonStyle(.plain).accessibilityIdentifier("phone-control")
                    .disabled(model.busy || !(ownControl || model.live?.report.reconnectRequired == true || model.playing || freshFrame))
                    .opacity(model.busy ? 0.5 : 1)
            } else if model.summary?.access == "view" { Text("当前设备仅可查看").font(.footnote).foregroundStyle(.secondary) }
        }.padding(16).background(Color(uiColor: .systemGroupedBackground))
            .sheet(isPresented: $textOpen, onDismiss: { draft = "" }) {
                NavigationStack {
                    VStack(alignment: .leading, spacing: 20) {
                        TextField("输入到手机的文字", text: $draft).textFieldStyle(.roundedBorder).accessibilityIdentifier("phone-text-input")
                        if model.failed { Text("操作尚未确认，请检查手机状态后再试。").font(.footnote).foregroundStyle(.red) }
                        Button("发送") {
                            let text = draft
                            Task {
                                await model.command("input", action: PhoneAction(type: "typeText", text: text))
                                if !model.failed { textOpen = false; draft = "" }
                            }
                        }.buttonStyle(.borderedProminent).disabled(model.busy || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !ownControl)
                            .accessibilityIdentifier("phone-text-send")
                        Spacer()
                    }.padding(24).navigationTitle("输入文字").navigationBarTitleDisplayMode(.inline)
                        .toolbar { ToolbarItem(placement: .cancellationAction) { Button("取消") { textOpen = false } } }
                }.presentationDetents([.height(260)])
            }
            .alert("停止当前手机任务？已经执行的操作无法撤回。", isPresented: $stopOpen) {
                Button("停止任务", role: .destructive) { if stopSession == model.live?.report.sessionId { command("cancel") } }
                Button("取消", role: .cancel) {}
            }
            .onChange(of: model.live?.report.controlEpoch) { textOpen = false; draft = "" }
            .onChange(of: model.summary?.binding) { stopOpen = false }
            .onChange(of: ownControl) { if !ownControl { textOpen = false; draft = "" } }
    }
    private var freshFrame: Bool { model.frame.map { Date().timeIntervalSince1970 * 1000 - $0.capturedAt < 5000 } ?? false }
    private var placeholder: LocalizedStringKey {
        if model.summary?.available == false { return "手机连接已结束，返回对话继续。" }
        if model.summary?.access == "none" { return "请在 Gateway 已配对设备设置中授权手机访问。" }
        if model.live?.report.reconnectRequired == true { return "任务进度已保留，请接管手机重新连接并完成所需操作。" }
        if model.failed { return "手机画面暂不可用，请检查连接后重试。" }
        return "正在连接手机…"
    }
    private func command(_ op: String, action: PhoneAction? = nil) { Task { await model.command(op, action: action) } }
}

struct PhoneTouchSurface: UIViewRepresentable {
    let onPointer: (String, CGPoint) -> Void
    func makeUIView(context: Context) -> PhoneTouchHost { PhoneTouchHost() }
    func updateUIView(_ view: PhoneTouchHost, context: Context) { view.onPointer = onPointer }
    static func dismantleUIView(_ view: PhoneTouchHost, coordinator: ()) { view.cancelTouch() }
}
final class PhoneTouchHost: UIView {
    var onPointer: (String, CGPoint) -> Void = { _, _ in }
    private var held: UITouch?
    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard held == nil, let touch = touches.first else { return }; held = touch; onPointer("down", touch.location(in: self))
    }
    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let held, touches.contains(held) else { return }; onPointer("move", held.location(in: self))
    }
    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let held, touches.contains(held) else { return }; onPointer("up", held.location(in: self)); self.held = nil
    }
    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) { cancelTouch() }
    func cancelTouch() { if held != nil { onPointer("cancel", .zero) }; held = nil }
}

struct PhoneConversationPages<Chat: View>: View {
    let showingPhone: Bool
    let canPage: Bool
    let onPage: (Bool) -> Void
    let phone: PhoneWorkspaceModel
    @ViewBuilder let chat: () -> Chat
    var body: some View {
        GeometryReader { proxy in
            HStack(spacing: 0) {
                chat().frame(width: proxy.size.width).accessibilityHidden(showingPhone)
                PhoneWorkspaceView(model: phone, onReturn: { onPage(false) }).frame(width: proxy.size.width).accessibilityHidden(!showingPhone)
            }.frame(width: proxy.size.width * 2, alignment: .leading)
                .offset(x: showingPhone ? -proxy.size.width : 0)
                .animation(.easeInOut(duration: 0.22), value: showingPhone)
                .simultaneousGesture(DragGesture(minimumDistance: 30).onEnded { value in
                    guard canPage, abs(value.translation.width) > 70, abs(value.translation.width) > abs(value.translation.height) * 1.5 else { return }
                    onPage(value.translation.width < 0)
                }, including: canPage ? .all : .subviews)
        }.clipped()
    }
}
