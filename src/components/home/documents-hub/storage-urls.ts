import { supabase } from "@/integrations/supabase/client";

const SIGNED_URL_TTL_SECONDS = 3600;

/**
 * Characters that must never reach Supabase Storage's `download` query parameter.
 *
 * rovno #284. storage-js builds the URL by string interpolation and then runs
 * `encodeURI` over the WHOLE thing (`&download=${options.download}` in
 * @supabase/storage-js). `encodeURI` deliberately does not escape the URL
 * delimiters `# & + = ?`, so any of them inside a filename corrupts the query:
 *
 *   "Акт #3.pdf"            -> everything from `#` is treated as a fragment,
 *                              the file saves with no extension at all
 *   "Смета & договор.pdf"   -> truncates at `&` and injects a stray parameter
 *
 * Pre-encoding with `encodeURIComponent` does NOT fix it: storage-js then
 * encodes our `%` signs again and the name arrives double-escaped. So the only
 * safe move at this layer is to remove the delimiters before handing the name
 * over. Russian filenames routinely contain `#` and `&`, so this is an everyday
 * input, not an edge case.
 *
 * Note this is the FILENAME only, never the object path.
 */
const UNSAFE_DOWNLOAD_NAME_CHARS = /[#&+=?%\\/]+/g;

/** Collapse the delimiters above into a single safe separator, keeping the extension intact. */
export function sanitizeDownloadFilename(filename: string, fallback = "document"): string {
  const cleaned = filename
    .replace(UNSAFE_DOWNLOAD_NAME_CHARS, " ")
    // Control characters (CR/LF included) would break the Content-Disposition
    // header itself. Written as an explicit ESCAPED range rather than a literal
    // character class, so ordinary punctuation such as `-` is left untouched -
    // a literal `[ -]` here would silently strip every hyphen from the name.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || fallback;
}

/** Helper to fetch a signed URL imperatively (for download/view buttons on tiles). */
export async function openStorageUrlInNewTab(bucket: string, objectPath: string): Promise<boolean> {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(objectPath, SIGNED_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) return false;
  window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  return true;
}

export async function downloadStorageUrl(bucket: string, objectPath: string, filename: string): Promise<boolean> {
  const safeName = sanitizeDownloadFilename(filename);
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(objectPath, SIGNED_URL_TTL_SECONDS, {
    download: safeName,
  });
  if (error || !data?.signedUrl) return false;

  const link = document.createElement("a");
  link.href = data.signedUrl;
  link.download = safeName;
  // rovno #284. `target="_blank"` is NOT cosmetic here, it is damage control.
  // A storage URL is cross-origin, so the `download` ATTRIBUTE is ignored and
  // the `?download=` parameter (which sets Content-Disposition: attachment) is
  // what actually saves the file. When that response is NOT an attachment -
  // the object was deleted between listing and click, storage returns 4xx/5xx,
  // or the signature expired - a same-tab anchor NAVIGATES THE WHOLE SPA to a
  // Supabase error page, and the user loses the dialog and their place in the
  // app. Opening in a new context confines any such failure to a throwaway tab,
  // which is the one good property the `window.open` call this replaced had.
  // On the success path the tab never materializes: an attachment response does
  // not create a document to display.
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  return true;
}
