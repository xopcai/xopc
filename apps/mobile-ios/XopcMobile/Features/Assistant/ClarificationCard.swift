import SwiftUI

struct ClarificationCard: View {
    let clarification: ClarificationRequest
    let isSubmitting: Bool
    let errorMessage: String?
    let onRespond: (String, String?) -> Void

    @State private var answer = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label(
                clarification.kind == "approval" ? "需要确认" : "助手需要补充信息",
                systemImage: clarification.kind == "approval" ? "checkmark.shield" : "questionmark.bubble"
            )
            .font(.headline)
            .foregroundStyle(.blue)

            Text(clarification.question)
                .font(.body.weight(.medium))
                .textSelection(.enabled)

            if let suggestion = clarification.suggestedAnswer, !suggestion.isEmpty {
                Text(suggestion)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            if let choices = clarification.choices, !choices.isEmpty {
                ForEach(choices, id: \.self) { choice in
                    Button(choice) {
                        onRespond("answer", choice)
                    }
                    .buttonStyle(.bordered)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .disabled(isSubmitting)
                }
            }

            HStack(alignment: .bottom, spacing: 8) {
                TextField("输入补充信息", text: $answer, axis: .vertical)
                    .lineLimit(1 ... 4)
                    .textFieldStyle(.roundedBorder)
                Button("提交") {
                    onRespond("answer", answer)
                }
                .buttonStyle(.borderedProminent)
                .disabled(answer.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isSubmitting)
            }

            HStack {
                Button("由助手决定") {
                    onRespond("agent_decide", nil)
                }
                Button("取消任务", role: .destructive) {
                    onRespond("cancel", nil)
                }
                if isSubmitting {
                    Spacer()
                    ProgressView()
                }
            }
            .buttonStyle(.borderless)
            .disabled(isSubmitting)

            if let errorMessage {
                Text(errorMessage)
                    .font(.caption)
                    .foregroundStyle(.red)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.blue.opacity(0.07), in: .rect(cornerRadius: 16))
        .overlay {
            RoundedRectangle(cornerRadius: 16)
                .stroke(Color.blue.opacity(0.2))
        }
        .accessibilityElement(children: .contain)
    }
}
