import { supabase } from "@/integrations/supabase/client";

const SIGNED_URL_TTL_SECONDS = 3600;

/**
 * Characters that must never reach the saved filename.
 *
 * rovno #284, round 3. Earlier revisions of this file sanitized for the
 * `?download=` query parameter of a signed URL, because storage-js interpolates
 * that value into the URL and `encodeURI` leaves `# & + = ?` unescaped. That
 * whole class of problem is GONE: `downloadStorageUrl` no longer asks the
 * server to set Content-Disposition at all. It fetches the object and saves it
 * through a same-origin blob object URL, where the anchor's `download`
 * attribute is honored and the filename never touches a URL or an HTTP header.
 * So `# & + = %` are all fine now, and «Акт #3.pdf» keeps its name.
 *
 * What remains is FILESYSTEM safety for the name the browser will write:
 * - `/` and `\` are path separators;
 * - `< > : " | ? *` are forbidden on Windows;
 * - control characters (CR/LF included) are never valid in a filename.
 */
// eslint-disable-next-line no-control-regex
const UNSAFE_FILENAME_CHARS = /[<>:"/\\|?*\u0000-\u001f\u007f]+/g;

/** Longest basename we will ask a filesystem to store; APFS/ext4 cap names at 255 bytes. */
const MAX_FILENAME_CHARS = 200;

const FILENAME_EXTENSION_RE = /\.[A-Za-z0-9]{1,8}$/;

/**
 * Make a filename safe to save, preserving as much of the original as possible.
 *
 * - strips filesystem-unsafe and control characters, collapsing runs to a space;
 * - caps the length at MAX_FILENAME_CHARS, keeping the extension;
 * - a name that collapses to nothing, or to a bare extension («&&&.pdf» → «.pdf»,
 *   which would save as a hidden dot-file with no basename), gets the fallback
 *   basename in front.
 */
export function sanitizeDownloadFilename(filename: string, fallback = "document"): string {
  let cleaned = filename
    .replace(UNSAFE_FILENAME_CHARS, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return fallback;
  if (cleaned.startsWith(".")) cleaned = `${fallback}${cleaned}`;
  if (cleaned.length > MAX_FILENAME_CHARS) {
    const extension = FILENAME_EXTENSION_RE.exec(cleaned)?.[0] ?? "";
    cleaned = cleaned.slice(0, MAX_FILENAME_CHARS - extension.length).trimEnd() + extension;
  }
  return cleaned;
}

/**
 * A downloaded file must carry an extension, or the OS cannot open it.
 *
 * Callers do not reliably have one: the documents-hub views only carry the
 * user-entered document TITLE («Договор №5»), and a stored filename can in
 * principle be blank. The storage object path is server-generated from the
 * upload and usually ends in the real extension, so recover it from there.
 * If neither side has an extension, return the name unchanged rather than
 * invent one: a wrong extension is worse than none.
 *
 * Multi-part extensions («x.tar.gz») are recovered as their last segment
 * («.gz») - imperfect, deliberate, and better than nothing.
 */
export function ensureFilenameExtension(filename: string, objectPath: string): string {
  if (FILENAME_EXTENSION_RE.test(filename)) return filename;
  const extension = FILENAME_EXTENSION_RE.exec(objectPath)?.[0];
  return extension ? `${filename}${extension}` : filename;
}

/** Helper to fetch a signed URL imperatively (for view buttons on tiles). */
export async function openStorageUrlInNewTab(bucket: string, objectPath: string): Promise<boolean> {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(objectPath, SIGNED_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) return false;
  window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  return true;
}

/**
 * Download a storage object under a caller-supplied filename.
 *
 * rovno #284. Three designs were tried here, and this one is kept because its
 * failure modes are the only honest ones:
 *
 * 1. `window.open(signedUrl)` - not a download at all: no Content-Disposition,
 *    so a PDF opened a tab, and the saved name was whatever the URL implied.
 * 2. `<a download href=signedUrl target=_blank>` with `?download=` on the URL -
 *    a real download, but the filename rode a URL parameter into a server-built
 *    HTTP header (injection surface + `encodeURI` corruption of `# & + =`),
 *    HTTP failures were undetectable (the helper had already returned true),
 *    and the post-await programmatic click of a window-opening anchor sat in
 *    popup-blocker territory.
 * 3. THIS: fetch the object, save it through a blob object URL. The blob is
 *    same-origin, so the `download` attribute is honored and the filename never
 *    leaves the client; no window opens, so there is nothing to popup-block;
 *    and every failure - signing, HTTP status, network - is observable here,
 *    so `false` reliably means "tell the user".
 *
 * Cost: the object passes through memory. Project documents are photos, PDFs
 * and spreadsheets, tens of megabytes at the worst, which is acceptable.
 */
export async function downloadStorageUrl(bucket: string, objectPath: string, filename: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(objectPath, SIGNED_URL_TTL_SECONDS);
    if (error || !data?.signedUrl) return false;

    const response = await fetch(data.signedUrl);
    if (!response.ok) return false;
    const blob = await response.blob();

    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = sanitizeDownloadFilename(ensureFilenameExtension(filename.trim(), objectPath));
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    // Not immediate: Safari needs the object URL alive until the save begins.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
    return true;
  } catch {
    // Signing rejection or a network-level fetch failure. Either way the caller
    // gets a false and can surface it; nothing has navigated anywhere.
    return false;
  }
}
