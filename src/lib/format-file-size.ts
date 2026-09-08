/**
 * Human-readable file size, locale-aware through Intl's unit formatting
 * ("1,5 МБ" under ru, "1.5 MB" under en). Binary steps, one decimal at most.
 */
export function formatFileSize(bytes: number, locale: string): string {
  const units: Array<{ unit: "kilobyte" | "megabyte" | "gigabyte"; size: number }> = [
    { unit: "gigabyte", size: 1024 ** 3 },
    { unit: "megabyte", size: 1024 ** 2 },
    { unit: "kilobyte", size: 1024 },
  ];
  for (const { unit, size } of units) {
    if (bytes >= size) {
      return new Intl.NumberFormat(locale, {
        style: "unit",
        unit,
        maximumFractionDigits: 1,
      }).format(bytes / size);
    }
  }
  return new Intl.NumberFormat(locale, { style: "unit", unit: "byte", maximumFractionDigits: 0 }).format(bytes);
}
