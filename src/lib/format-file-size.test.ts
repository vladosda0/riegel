import { describe, expect, it } from "vitest";
import { formatFileSize } from "./format-file-size";

describe("formatFileSize", () => {
  it("picks the unit by magnitude", () => {
    expect(formatFileSize(512, "en")).toBe("512B");
    expect(formatFileSize(1024, "en")).toBe("1 kB");
    expect(formatFileSize(1_572_864, "en")).toBe("1.5 MB");
    expect(formatFileSize(3 * 1024 ** 3, "en")).toBe("3 GB");
    expect(formatFileSize(2 * 1024 ** 4, "en")).toBe("2 TB");
  });

  it("never renders an unpluralised English unit word", () => {
    // Intl's "short" unitDisplay is not pluralised: it gave "512 byte" and
    // "1,023 byte". Narrow avoids the word entirely.
    for (const bytes of [0, 1, 2, 512, 1023]) {
      expect(formatFileSize(bytes, "en")).not.toContain("byte");
    }
  });

  it("follows the locale's number formatting", () => {
    expect(formatFileSize(1_572_864, "ru")).toMatch(/^1,5\s/);
    expect(formatFileSize(512, "ru")).toMatch(/^512\s*Б$/);
    expect(formatFileSize(2 * 1024 ** 4, "ru")).toMatch(/^2\s*ТБ$/);
  });
});
