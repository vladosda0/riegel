import { describe, expect, it } from "vitest";
import { formatFileSize } from "./format-file-size";

describe("formatFileSize", () => {
  it("picks the unit by magnitude", () => {
    expect(formatFileSize(512, "en")).toBe("512 byte");
    expect(formatFileSize(1024, "en")).toBe("1 kB");
    expect(formatFileSize(1_572_864, "en")).toBe("1.5 MB");
    expect(formatFileSize(3 * 1024 ** 3, "en")).toBe("3 GB");
  });

  it("follows the locale's number formatting", () => {
    expect(formatFileSize(1_572_864, "ru")).toMatch(/^1,5\s/);
  });
});
