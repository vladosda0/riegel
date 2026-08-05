/**
 * The file types the document uploaders offer in the OS file picker.
 *
 * Scope note (rovno #284, slice S6). `accept` is a picker filter, never a
 * validation gate: the backend and RLS remain the only real gates, and
 * `prepare_document_upload` accepts an arbitrary mime string regardless.
 *
 * But do NOT read that as "harmless, so keep it tight". On DESKTOP the user can
 * escape it via the picker's "All Files" option; on iOS and Android the Files
 * picker ENFORCES it with no such escape, so anything missing here is a format
 * a phone user simply cannot attach. An earlier revision of this comment claimed
 * the list was merely a hint and was wrong on exactly that point.
 *
 * So the list is deliberately GENEROUS, and covers what the product handles end
 * to end (store, version, hand back) rather than what it can preview inline.
 * Only `image/*` and `application/pdf` render in the preview dialog today - slice
 * S4 tracks the rest - but a .pptx or .dwg uploads and downloads correctly, and
 * refusing it at the picker would remove a working capability to paper over a
 * missing one. When in doubt, add the extension: the cost of a wrong inclusion
 * is a file nobody previews, and the cost of a wrong exclusion is a user on a
 * phone who cannot attach their document at all.
 *
 * HEIC/HEIF are spelled out explicitly because `image/*` alone does not match
 * them in some Android browsers. `ProjectGallery.tsx` already does the same.
 */
export const DOCUMENT_UPLOAD_ACCEPT = [
  "image/*",
  ".heic",
  ".heif",
  // documents
  ".pdf",
  ".doc",
  ".docx",
  ".odt",
  ".rtf",
  ".txt",
  ".pages",
  // spreadsheets
  ".xls",
  ".xlsx",
  ".ods",
  ".csv",
  ".numbers",
  // presentations
  ".ppt",
  ".pptx",
  ".odp",
  ".key",
  // drawings and archives (delivered as-is; no preview, but they round-trip)
  ".dwg",
  ".dxf",
  ".zip",
  ".rar",
  ".7z",
].join(",");
