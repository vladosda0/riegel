// The one CSV emitter in the app. Every export routes through it so there is a
// single formula-injection guard and a single quoting rule to audit.
//
// This module exists because that was NOT true: the portfolio exporter was
// hardened for #181 while the estimate exporter carried its own weaker copy with
// no guard at all and a quote test missing `\r`. The estimate export is the more
// exposed of the two, since those files are routinely sent to clients and
// contractors. Two divergent copies of a security-critical function is how the
// gap appeared, so do not reintroduce a local one: add the case here instead.
//
// The separator is a hard-coded comma, deliberately. `escapeCsv` decides when to
// quote by testing for the separator literally, so a caller-chosen separator
// would silently stop quoting cells that contain it. If the delimiter ever
// becomes configurable (see rovno #196 on ru-RU Excel), the quote test below has
// to move in the same change.

/**
 * Escape one cell for CSV, neutralizing spreadsheet formula injection.
 *
 * A cell starting with `=` `+` `-` `@` (or tab/CR) is evaluated as a formula by
 * Excel/Sheets even inside quotes, so prefix a literal apostrophe before
 * RFC-quoting. Skip plain signed numbers (e.g. `"-100000.00"`) so negative
 * money/percent cells stay numeric rather than becoming text; the match is
 * anchored end to end so free text merely opening with `-<digit>` is still
 * guarded.
 *
 * Importers strip leading whitespace before evaluating a cell, so the trigger is
 * also tested behind optional leading whitespace. `\s` is the full ECMAScript
 * WhiteSpace set (space, tab, CR, LF, VT, FF, NBSP, BOM, U+2028...), which
 * closes that whole family at once: do NOT narrow it to an ASCII-only strip. The
 * bare class is kept alongside it so a leading tab/CR is still guarded when what
 * follows is not itself a trigger. Both tests are regexes, which coerce, so the
 * one non-string a cell can actually be (an undefined label lookup) degrades to
 * an empty cell instead of aborting the export. Other non-string shapes are NOT
 * supported: they would still throw on `.replace` below.
 */
export function escapeCsv(value: string): string {
  const isPlainNumber = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value);
  const opensFormula = /^[=+\-@\t\r]/.test(value) || /^\s*[=+\-@]/.test(value);
  const guarded = !isPlainNumber && opensFormula ? `'${value}` : value;
  // `\r` belongs in this test as much as `\n` does: a lone CR is a record
  // separator to any parser that honours it, so an unquoted cell containing one
  // splits into two rows (row injection, independent of the formula issue).
  if (/[",\r\n]/.test(guarded)) {
    return `"${guarded.replace(/"/g, '""')}"`;
  }
  return guarded;
}

/** Escape and join one row of raw cells into a CSV record. */
export function buildCsvRow(cells: string[]): string {
  return cells.map((cell) => escapeCsv(cell)).join(",");
}

/** Build a whole CSV document from raw cells. Callers own the BOM, if any. */
export function buildCsvDocument(rows: string[][], eol: string = "\n"): string {
  return rows.map((row) => buildCsvRow(row)).join(eol);
}
