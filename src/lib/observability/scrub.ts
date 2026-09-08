/**
 * PII scrubbing for outgoing error-tracking events (Sentry).
 *
 * Applied as the Sentry `beforeSend` hook via `scrubEventSafe`. The policy is
 * aggressive-by-default: rather scrub too much than leak a token or an email
 * into a US-hosted error tracker (152-ФЗ). Full pattern rationale + legal
 * notes live in docs/observability/sentry-scrubbing.md — update BOTH files
 * together.
 *
 * Mirrored (same rules, same order) in
 * rovno-db/supabase/functions/_shared/scrub.ts for edge functions — keep the
 * two copies in sync, the repos cannot share code.
 *
 * Fail-closed: if scrubbing itself throws, the event is DROPPED (`null`),
 * never sent raw.
 */

interface ScrubRule {
  name: string;
  pattern: RegExp;
  replacement: string;
}

/**
 * Order matters: token-ish patterns run before email/phone so a partially
 * scrubbed token can never survive as something the later rules miss.
 *
 * Note on the Cyrillic rules: JS `\b` only understands ASCII word chars, so
 * boundaries around Cyrillic use lookbehind instead.
 */
const SCRUB_RULES: ScrubRule[] = [
  {
    // Any JWT-shaped token (Supabase access tokens, anon/service keys).
    name: "jwt",
    pattern: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
    replacement: "[TOKEN]",
  },
  {
    // Authorization header values that are not JWT-shaped (opaque tokens).
    name: "bearer",
    pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
    replacement: "Bearer [TOKEN]",
  },
  {
    // Credential-bearing PATH segments. On these routes the segment IS the
    // credential, and the query-param rule below cannot see it because it is
    // not a query param. Kept in step with the `secret: true` entries of
    // ANALYTICS_ROUTES (src/lib/analytics.ts), which redact the same three
    // routes for Metrika.
    name: "credential-path-segment",
    // %2f as well as /: the app itself percent-encodes these paths into a
    // query param (InviteAccept builds /auth/login?next=%2Finvite%2Faccept%2F…),
    // and the encoded form reached the tracker verbatim while this matched only
    // literal separators. The `i` flag covers %2F and an upper-cased route.
    pattern:
      /((?:\/|%2f)(?:share(?:\/|%2f)document|share(?:\/|%2f)estimate|invite(?:\/|%2f)accept)(?:\/|%2f))[^/?#&\s"'<>]+/gi,
    replacement: "$1[FILTERED]",
  },
  {
    // A document-share token also travels OUTSIDE any URL: it is the second
    // element of the react-query key, which the data-layer error reporter puts
    // in `extra`. public.create_document_share mints it as
    // encode(gen_random_bytes(24), 'hex'): exactly 48 lowercase hex chars.
    // The \b anchors keep it from biting a 40- or 64-char digest.
    name: "share-token",
    pattern: /\b[0-9a-f]{48}\b/g,
    replacement: "[TOKEN]",
  },
  {
    // Sensitive query-string params (keeps the param name, drops the value).
    name: "sensitive-query-param",
    pattern:
      /([?&](?:apikey|api[_-]?key|token|access[_-]?token|refresh[_-]?token|password|secret|code)=)[^&#\s]+/gi,
    replacement: "$1[FILTERED]",
  },
  {
    name: "email",
    pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    replacement: "[EMAIL]",
  },
  {
    // RU phone formats: +7 / 8 / 7 prefix + 10 digits with optional
    // spaces / dashes / parens between groups. The trailing `\b` keeps it from
    // eating longer digit runs (timestamps, ids).
    name: "phone-ru",
    pattern: /(?:\+7|\b[78])[\s\-()]*\d{3}[\s\-()]*\d{3}[\s\-()]*\d{2}[\s\-()]*\d{2}\b/g,
    replacement: "[PHONE]",
  },
  {
    // Physical-address heuristic (spec: "ул.", "г.", "д." keywords). Two
    // alternations: full words may omit the dot, one-letter abbreviations
    // require it (bare "г"/"д" are too common). Deliberately over-matches
    // ("2025 г. Москва слово" loses the tail) — acceptable per fail-private
    // policy; error messages are overwhelmingly technical English.
    //
    // The leading `(^|[^А-ЯЁа-яё])` capture group is a lookbehind-free Cyrillic
    // boundary (JS `\b` is ASCII-only): it asserts the keyword is not mid-word,
    // then $1 re-emits the boundary char. NOT a real lookbehind — this module
    // is statically imported by the entry bundle (main.tsx → sentry.ts →
    // scrub.ts), and a `(?<=...)` literal is a parse-time SyntaxError on
    // Safari/iOS < 16.4, which would white-screen the whole app.
    name: "address-ru",
    pattern:
      /(^|[^А-ЯЁа-яё])(?:(?:улица|проспект|переулок|квартира|город|дом|шоссе|бульвар|набережная|область|мкр)\.?|(?:ул|просп|пр-т|пер|кв|обл|наб|б-р|г|д)\.)\s*[«"']?[А-ЯЁа-яё0-9][^,;\n]{0,40}/g,
    replacement: "$1[ADDRESS]",
  },
];

/** Apply every scrub rule to a single string. */
export function scrubText(value: string): string {
  let out = value;
  for (const rule of SCRUB_RULES) {
    out = out.replace(rule.pattern, rule.replacement);
  }
  return out;
}

const MAX_DEPTH = 8;

/**
 * Recursively scrub every string in a plain data structure (arrays + plain
 * objects). Keys are scrubbed too — `extra` dicts keyed by email exist in the
 * wild. Non-plain objects (Date, class instances) are returned as-is; depth
 * and cycles are capped defensively.
 */
export function scrubDeep(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") return scrubText(value);
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_DEPTH) return "[MAX_DEPTH]";
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => scrubDeep(item, depth + 1, seen));
  }

  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return value;

  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    out[scrubText(key)] = scrubDeep(entry, depth + 1, seen);
  }
  return out;
}

type Dict = Record<string, unknown>;

/** Request headers that may survive (values still text-scrubbed). */
const HEADER_ALLOWLIST = new Set([
  "user-agent",
  "referer",
  "content-type",
  "accept",
  "accept-language",
]);

function scrubExceptionValues(exception: Dict | undefined): void {
  const values = exception?.values;
  if (!Array.isArray(values)) return;
  for (const item of values) {
    const v = item as Dict;
    if (typeof v.value === "string") v.value = scrubText(v.value);
    // Stack traces are preserved (spec) — frames are file/function names, not
    // user data. Local variables would be, so drop them defensively.
    const stacktrace = v.stacktrace as Dict | undefined;
    const frames = stacktrace?.frames;
    if (Array.isArray(frames)) {
      for (const frame of frames) delete (frame as Dict).vars;
    }
  }
}

function scrubBreadcrumbList(list: unknown): void {
  if (!Array.isArray(list)) return;
  for (const item of list) {
    const crumb = item as Dict;
    if (typeof crumb.message === "string") crumb.message = scrubText(crumb.message);
    if (crumb.data !== undefined) crumb.data = scrubDeep(crumb.data);
  }
}

function scrubRequest(request: Dict | undefined): void {
  if (!request) return;
  if (typeof request.url === "string") request.url = scrubText(request.url);
  if (typeof request.query_string === "string") {
    request.query_string = scrubText(request.query_string);
  }
  delete request.cookies;
  if (request.data !== undefined) request.data = scrubDeep(request.data);
  const headers = request.headers;
  if (headers && typeof headers === "object" && !Array.isArray(headers)) {
    for (const key of Object.keys(headers)) {
      const dict = headers as Dict;
      if (!HEADER_ALLOWLIST.has(key.toLowerCase())) {
        delete dict[key];
      } else if (typeof dict[key] === "string") {
        dict[key] = scrubText(dict[key] as string);
      }
    }
  }
}

/**
 * Scrub a Sentry event in place and return it. Structural typing (`Dict`)
 * instead of Sentry types keeps this module dependency-free so the Deno
 * mirror stays byte-compatible.
 */
export function scrubErrorEvent<E extends Dict>(event: E): E {
  const e = event as Dict;

  if (typeof e.message === "string") e.message = scrubText(e.message);
  const logentry = e.logentry as Dict | undefined;
  if (logentry && typeof logentry.message === "string") {
    logentry.message = scrubText(logentry.message);
  }

  scrubExceptionValues(e.exception as Dict | undefined);

  // JS SDK sends breadcrumbs as an array; some SDKs wrap them in {values}.
  if (Array.isArray(e.breadcrumbs)) {
    scrubBreadcrumbList(e.breadcrumbs);
  } else if (e.breadcrumbs && typeof e.breadcrumbs === "object") {
    scrubBreadcrumbList((e.breadcrumbs as Dict).values);
  }

  scrubRequest(e.request as Dict | undefined);

  // Only the pseudonymous user id may survive (never email/ip/username).
  const user = e.user as Dict | undefined;
  if (user && typeof user === "object") {
    e.user = user.id !== undefined ? { id: user.id } : {};
  }

  if (e.tags && typeof e.tags === "object") e.tags = scrubDeep(e.tags);
  if (e.extra && typeof e.extra === "object") e.extra = scrubDeep(e.extra);
  if (e.contexts && typeof e.contexts === "object") e.contexts = scrubDeep(e.contexts);

  return event;
}

/**
 * Fail-closed `beforeSend`: if scrubbing throws for any reason the event is
 * dropped entirely — better to lose one error report than to ship raw PII.
 */
export function scrubEventSafe<E extends Dict>(event: E): E | null {
  try {
    return scrubErrorEvent(event);
  } catch {
    return null;
  }
}
