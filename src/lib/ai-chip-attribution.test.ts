import { describe, expect, it } from "vitest";
import { resolveFirstMoveEntry } from "@/lib/ai-chip-attribution";

const SEED = { chipKey: "ai.sidebar.suggestion.addTasks", text: "Добавить задачи" };

describe("resolveFirstMoveEntry", () => {
  it("attributes an unedited seeded prompt to its chip", () => {
    expect(resolveFirstMoveEntry("Добавить задачи", SEED)).toEqual({
      entry: "chip",
      chipKey: "ai.sidebar.suggestion.addTasks",
    });
  });

  it("ignores whitespace the composer may have introduced", () => {
    expect(resolveFirstMoveEntry("  Добавить   задачи ", SEED)).toEqual({
      entry: "chip",
      chipKey: "ai.sidebar.suggestion.addTasks",
    });
  });

  it("counts an edited prompt as manual, not as a chip", () => {
    expect(resolveFirstMoveEntry("Добавить задачи по демонтажу", SEED)).toStrictEqual({ entry: "manual" });
  });

  it("counts a prompt typed from scratch as manual", () => {
    expect(resolveFirstMoveEntry("почему висит демонтаж санузла", null)).toStrictEqual({ entry: "manual" });
  });

  it("treats a missing seed as manual", () => {
    expect(resolveFirstMoveEntry("Добавить задачи", undefined)).toStrictEqual({ entry: "manual" });
  });

  it("never attributes to a chip whose text is blank", () => {
    expect(resolveFirstMoveEntry("", { chipKey: "ai.sidebar.suggestion.addTasks", text: "   " }))
      .toStrictEqual({ entry: "manual" });
  });

  it("does not attribute an empty send to a real chip", () => {
    expect(resolveFirstMoveEntry("   ", SEED)).toStrictEqual({ entry: "manual" });
  });
});
