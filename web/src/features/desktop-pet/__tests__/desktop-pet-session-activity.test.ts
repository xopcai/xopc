import { describe, expect, it } from "vitest";

import {
  isDesktopPetActivityDismissed,
  mergeDesktopPetActivities,
  visibleDesktopPetActivities,
} from "../desktop-pet-session-state";

describe("desktop pet session activity", () => {
  it("keeps the newest update for a session and limits visible sessions to three", () => {
    const sessions = ["a", "b", "c", "d"].map((sessionKey, index) => ({ sessionKey, runId: sessionKey, sessionLabel: sessionKey, sequence: index + 1, timestamp: index, state: index === 3 ? "success" : "running", phase: "running", action: "正在处理" }));
    const merged = mergeDesktopPetActivities({}, sessions as never[]);
    expect(visibleDesktopPetActivities(Object.values(merged), 1_001)).toHaveLength(3);
  });

  it("keeps a dismissal within one run state and reveals important state transitions", () => {
    const running = mergeDesktopPetActivities({}, [{ sessionKey: "a", runId: "run-1", sessionLabel: "A", sequence: 1, timestamp: 1, state: "running", phase: "running", action: "Working" }]).a;
    expect(isDesktopPetActivityDismissed(running, { runId: "run-1", state: "running" })).toBe(true);

    const waiting = mergeDesktopPetActivities({ a: running }, [{ ...running, sequence: 2, state: "waiting", phase: "waiting", action: "Needs input" }]).a;
    expect(isDesktopPetActivityDismissed(waiting, { runId: "run-1", state: "running" })).toBe(false);

    const nextRun = mergeDesktopPetActivities({ a: waiting }, [{ ...running, runId: "run-2", sequence: 1, timestamp: 3 }]).a;
    expect(isDesktopPetActivityDismissed(nextRun, { runId: "run-1", state: "running" })).toBe(false);
  });

  it("clears an earlier public summary when feedback becomes private", () => {
    const publicUpdate = {
      sessionKey: "a",
      runId: "run-1",
      sessionLabel: "A",
      sequence: 1,
      timestamp: 1,
      state: "running" as const,
      phase: "running" as const,
      action: "Working",
      publicSummary: "Safe progress",
      feedback: {
        version: 2 as const,
        taskState: "working" as const,
        sensitivity: "public" as const,
      },
    };
    const current = mergeDesktopPetActivities({}, [publicUpdate]);
    const privateUpdate = {
      ...publicUpdate,
      sequence: 2,
      state: "error" as const,
      feedback: {
        version: 2 as const,
        taskState: "error" as const,
        sensitivity: "private" as const,
      },
      publicSummary: undefined,
    };

    expect(mergeDesktopPetActivities(current, [privateUpdate]).a.publicSummary).toBeUndefined();
  });
});
