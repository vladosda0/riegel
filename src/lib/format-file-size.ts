/**
 * Human-readable file size, locale-aware through Intl's unit formatting
 * ("1,5 МБ" under ru, "1.5 MB" under en). Binary steps, one decimal at most.
 *
 * The byte step uses unitDisplay "narrow" because "short" is not pluralised by
 * Intl: English renders "512 byte" and "1,023 byte" for every count. Narrow
 * gives "512B" in English and leaves Russian at "512 Б".
 */
export function formatFileSize(bytes: number, locale: string): string {
  const units: Array<{ unit: "terabyte" | "gigabyte" | "megabyte" | "kilobyte"; size: number }> = [
    { unit: "terabyte", size: 1024 ** 4 },
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
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: "byte",
    unitDisplay: "narrow",
    maximumFractionDigits: 0,
  }).format(bytes);
}
