# Sentry PII scrubbing — configuration & legal review

**Status:** implemented, awaiting legal sign-off (Open Question #2, 152-ФЗ).
**Owners of the code:** `src/lib/observability/scrub.ts` (frontend),
`rovno-db/supabase/functions/_shared/scrub.ts` (edge functions). The two files
are byte-for-byte mirrors of the same rules — **change both together**, same
precedent as the plans / tier_limits three-way sync.

## Why this exists

Sentry is a US-hosted error tracker. Under 152-ФЗ we must not let personal
data of Russian users leave to it. Estimates, feedback and profiles contain
names, phones, emails and physical addresses. Rather than trust that error
messages never contain PII, every outgoing event passes through an
aggressive, **fail-closed** scrubber in Sentry's `beforeSend` hook before it
leaves the browser / edge runtime.

Design principles (from the spec's "fail-open vs fail-closed" note):

- **Scrubbing is fail-CLOSED.** If the scrubber throws, the event is dropped
  (`null`), never sent raw. (Everything *else* about Sentry is fail-open — a
  Sentry outage never breaks the product.)
- **Over-match on purpose.** A false `[ADDRESS]` in a stack trace is
  acceptable; a leaked real address is not.
- **Stack traces are preserved** — frames are file/function names, not user
  data. Local variables (`frame.vars`) are stripped defensively.
- **Feedback-widget text never goes to Sentry at all** — it goes only to the
  `user_feedback` table + Vlad's inbox (separate channel, see R-8).

## What is stripped

Rules run **in this order** (token patterns first, so a partial token can't
survive into a later rule). Each is a global regex applied to every string in
the event (message, exception values, breadcrumb messages, tags, extra,
contexts, request url/query — recursively, keys included).

| Rule | Pattern (summary) | Replacement |
|---|---|---|
| `jwt` | `eyJ…​.…​.…​` three base64url segments | `[TOKEN]` |
| `bearer` | `Bearer <opaque>` | `Bearer [TOKEN]` |
| `credential-path-segment` | `/share/document/<t>`, `/share/estimate/<t>`, `/invite/accept/<t>`, and the same three percent-encoded (`%2Fshare%2Fdocument%2F<t>`, as the app writes them into `?next=`) | `…/[FILTERED]` |
| `share-token` | a bare 48-lowercase-hex document-share token | `[TOKEN]` |
| `sensitive-query-param` | `?…apikey/api_key/token/access_token/refresh_token/password/secret/code=VALUE` | `…=[FILTERED]` |
| `email` | `local@domain.tld` | `[EMAIL]` |
| `phone-ru` | `+7 / 8 / 7` + 10 digits with spaces/dashes/parens | `[PHONE]` |
| `address-ru` | `ул.` `г.` `д.` `кв.` `город` `улица` … + following token | `[ADDRESS]` |

A credential that is neither in a URL nor 48-hex (an estimate share id, an
invite UUID) is not reachable by a text rule at all. Those are redacted at the
source instead: `redactQueryKey` in `src/lib/query-client.ts` replaces the
value elements of a credential-bearing react-query key before it is attached
to an event as `extra.queryKey`. Keep its `CREDENTIAL_QUERY_KEYS` set in step
with the `secret: true` routes in `src/lib/analytics.ts`.

The exact regexes live in `SCRUB_RULES` in `scrub.ts` with inline comments —
this table is the human-readable index, the code is the source of truth.

### Structural scrubbing (beyond text)

`scrubErrorEvent` also:

- reduces `event.user` to `{ id }` only — **never** email / ip_address /
  username / geo;
- deletes `request.cookies` entirely;
- drops every request header except an allowlist (`user-agent`, `referer`,
  `content-type`, `accept`, `accept-language`), and text-scrubs the survivors;
- strips `frame.vars` from every stack frame;
- caps recursion depth (8) and handles circular references, so a hostile /
  huge object can't hang the hook.

## Known limitations (disclose to legal)

1. **Heuristic, not exhaustive.** A name with no email/phone/address marker
   (e.g. a bare "Иван Петров" inside a validation message) is not caught. The
   mitigation is that error messages are overwhelmingly technical English
   (PostgREST / JS runtime), where names are rare. If legal needs
   zero-name-leakage, the escalation is self-hosted GlitchTip (spec R-17), for
   which this wrapper already isolates the SDK behind one façade module.
2. **`sendDefaultPii: false`** is set in both SDKs, so the SDK itself does not
   attach IP or cookies; the scrubber is the second line of defence.
3. **Session replay / webvisor are OFF** (they record raw PII); enabling them
   is explicitly out of v1 scope.

## How it's tested

- `src/lib/observability/scrub.test.ts` (21 cases) — the load-bearing suite:
  every rule, structural scrubbing, circular refs, depth cap, and the
  fail-closed drop.
- `rovno-db/supabase/functions/_shared/scrub.test.ts` (Deno) — asserts the
  mirror behaves identically on the same cases; runs in the edge-functions CI.

To verify manually: throw `new Error("contact ivan@mail.ru +7 912 345-67-89")`
from any component; the event in Sentry must read
`contact [EMAIL] [PHONE]`.

## Sign-off

- [ ] Legal reviewed the pattern list and limitation #1 above.
- [ ] Decision recorded: Sentry cloud accepted **/** GlitchTip required.
