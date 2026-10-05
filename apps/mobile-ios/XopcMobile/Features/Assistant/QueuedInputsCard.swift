import SwiftUI

struct QueuedInputsCard: View {
    let inputs: [QueuedInput]
    let errorMessage: String?
    let isUpdating: Bool
    let onUpdate: (QueuedInput, String) -> Void
    let onCancel: (QueuedInput) -> Void

    @State private var isExpanded = true
    @State private var editingInput: QueuedInput?
    @State private var editedText = ""
    @State private var showingEditor = false

    var body: some View {
        DisclosureGroup(isExpanded: $isExpanded) {
            VStack(spacing: 8) {
                ForEach(inputs) { input in
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: input.contextRefs?.isEmpty == false ? "at" : "text.bubble")
                            .foregroundStyle(.secondary)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(input.payloadDescription)
                                .font(.subheadline)
                            Text(input.effectiveDelivery == "steer"
                                ? LocalizedStringResource("引导当前回答")
                                : LocalizedStringResource("下一条"))
                                .font(.caption2.weight(.medium))
                                .foregroundStyle(.secondary)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        VStack(spacing: 6) {
                            if !input.content.isEmpty {
                                Button("编辑") {
                                    editingInput = input
                                    editedText = input.content
                                    showingEditor = true
                                }
                                .disabled(isUpdating)
                            }
                            Button("取消", role: .destructive) {
                                onCancel(input)
                            }
                            .disabled(isUpdating)
                        }
                    }
                    .padding(10)
                    .background(.background, in: .rect(cornerRadius: 10))
                }

                if let errorMessage {
                    Text(errorMessage)
                        .font(.caption)
                        .foregroundStyle(.red)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .padding(.top, 8)
        } label: {
            Label("待处理消息 \(inputs.count)", systemImage: "text.line.last.and.arrowtriangle.forward")
                .font(.subheadline.weight(.semibold))
        }
        .padding(12)
        .background(Color.orange.opacity(0.08), in: .rect(cornerRadius: 14))
        .tint(.orange)
        .alert("编辑待处理消息", isPresented: $showingEditor) {
            TextField("消息", text: $editedText, axis: .vertical)
            Button("取消", role: .cancel) {}
            Button("保存") {
                guard let editingInput else { return }
                onUpdate(editingInput, editedText)
            }
            .disabled(editedText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        } message: {
            Text("保存时会校验消息版本；若已变化，将重新载入最新队列。")
        }
    }
}
