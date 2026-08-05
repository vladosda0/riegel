/**
 * The file types the document uploader offers in the OS file picker.
 *
 * Scope note (rovno #284, slice S6): this is a UX hint, NOT a validation gate.
 * `accept` narrows the picker's default filter and a user can still override it,
 * so nothing here is a security or integrity control - the backend and RLS remain
 * the only real gates.
 *
 * The list covers what the product can handle END TO END, meaning store and hand
 * back. That is deliberately WIDER than what it can preview inline: today only
 * `image/*` and `application/pdf` render in the preview dialog (slice S4 tracks
 * the rest), but an .xlsx or .docx contract still uploads, downloads and versions
 * correctly, so refusing it at the picker would remove a working capability to
 * paper over a missing one.
 */
export const DOCUMENT_UPLOAD_ACCEPT = [
  "image/*",
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".csv",
  ".txt",
  ".rtf",
  ".odt",
  ".ods",
].join(",");
