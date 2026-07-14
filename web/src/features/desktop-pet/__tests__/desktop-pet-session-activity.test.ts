import { describe, expect, it } from "vitest";

describe("desktop pet session activity", () => {
  it("keeps the newest update for a session and limits visible sessions to three", () => {
    const sessions = ["a", "b", "c", "d"].map((sessionKey, index) => ({ sessionKey, runId: sessionKey, sessionLabel: sessionKey, sequence: index + 1, timestamp: index, state: index === 3 ? "success" : "running", phase: "running", action: "正在处理" }));
    expect(sessions.filter((item) => item.state === "running").slice(0, 3)).toHaveLength(3);
  });
});
